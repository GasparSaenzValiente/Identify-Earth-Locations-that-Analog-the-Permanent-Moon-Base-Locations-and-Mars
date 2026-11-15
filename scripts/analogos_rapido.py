#!/usr/bin/env python3
"""Comparación Andes-Deuteronilus: versión optimizada de analogos_actualizado.py.

Misma lógica científica y mismas filas de salida que el original, pero:
  * se puede importar y llamar por sitio (sin lanzar un proceso por punto);
  * caché de descargas compartida entre puntos y entre corridas;
  * descargas en paralelo con límite de concurrencia por servidor,
    control del "peso" de Open-Meteo y espera ante HTTP 429;
  * ERA5-Land: una sola consulta con las 5 variables (antes eran dos);
  * agrupado opcional por celda de grilla (ERA5-Land 0.1°, POWER
    0.5°x0.625° + 1°), para no repetir descargas idénticas;
  * modelo térmico hora a hora vectorizado con numpy.

Las constantes (CAT, DEFAULTS, NASA, URLs) se importan del original para
que haya una sola fuente de verdad.
"""

import argparse
import calendar
import collections
import csv
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

from analogos_actualizado import (  # noqa: F401  (se reexportan)
    CAT, DEFAULTS, ERA, FREEZE, LAYERS, NASA, POWER, THERMAL,
)

SOIL_PROPS = ["bdod", "cfvo", "sand", "clay", "soc"]
ERA_VARS = (
    ["soil_temperature_" + layer for layer in LAYERS]
    + ["soil_moisture_0_to_7cm"]
)
CATALOGO = [
    {
        "parametro": "t_hielo",
        "fuente": "https://tc.copernicus.org/articles/19/2653/2025/",
        "estado": (
            "53 sondeos regionales; datos originales no publicos. "
            "No se imputan al punto."
        ),
    },
    {
        "parametro": "perclorato",
        "fuente": "https://pubmed.ncbi.nlm.nih.gov/24165784/",
        "estado": (
            "Muestras de Atacama, Chile. No demuestran "
            "concentracion en puntos argentinos."
        ),
    },
    {
        "parametro": "suelo",
        "fuente": "https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html",
        "estado": (
            "Predicciones SoilGrids consultadas por WCS; "
            "no describen hielo masivo."
        ),
    },
]


# ---------------------------------------------------------------------------
# Errores
# ---------------------------------------------------------------------------

class FuenteNoDisponible(Exception):
    """Fallo transitorio (red, 5xx, 429, sin caché en modo offline)."""


class LimiteDiario(FuenteNoDisponible):
    """Open-Meteo devolvió 'Daily API request limit exceeded'."""


class ErrorPermanente(Exception):
    """El servidor rechazó la consulta (4xx distinto de 429)."""


def marca_transitorio(exc):
    return {"transitorio": True} if isinstance(exc, FuenteNoDisponible) else {}


# ---------------------------------------------------------------------------
# Transporte HTTP (requests con keep-alive si está instalado)
# ---------------------------------------------------------------------------

try:
    import requests
    from requests.adapters import HTTPAdapter
except ImportError:  # pragma: no cover
    requests = None

_hilo = threading.local()


def _sesion():
    s = getattr(_hilo, "sesion", None)
    if s is None:
        s = requests.Session()
        s.mount("https://", HTTPAdapter(pool_connections=4, pool_maxsize=4))
        _hilo.sesion = s
    return s


class _ErrorRed(Exception):
    pass


def _descargar(url, timeout, agente):
    """Devuelve (status, cuerpo, headers). Lanza _ErrorRed si no hubo respuesta."""
    if requests is not None:
        try:
            r = _sesion().get(
                url, timeout=timeout, headers={"User-Agent": agente}
            )
            return r.status_code, r.content, r.headers
        except requests.RequestException as exc:
            raise _ErrorRed(str(exc)) from exc
    try:
        req = urllib.request.Request(url, headers={"User-Agent": agente})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers
    except (OSError, ValueError) as exc:
        raise _ErrorRed(str(exc)) from exc


class LimitadorPeso:
    """Ventanas deslizantes de peso (p. ej. 600/min y 5000/h de Open-Meteo)."""

    def __init__(self, ventanas):
        self.ventanas = ventanas  # [(segundos, peso_max), ...]
        self.registro = collections.deque()
        self.lock = threading.Lock()

    def adquirir(self, peso):
        largo = max(s for s, _ in self.ventanas)
        while True:
            with self.lock:
                ahora = time.monotonic()
                while self.registro and ahora - self.registro[0][0] > largo:
                    self.registro.popleft()
                espera = 0.0
                for segundos, maximo in self.ventanas:
                    usados = [
                        (t, p) for t, p in self.registro
                        if ahora - t <= segundos
                    ]
                    if sum(p for _, p in usados) + peso > maximo and usados:
                        acumulado = sum(p for _, p in usados) + peso - maximo
                        for t, p in usados:
                            acumulado -= p
                            if acumulado <= 0:
                                espera = max(espera, segundos - (ahora - t))
                                break
                if espera <= 0:
                    self.registro.append((ahora, peso))
                    return
            time.sleep(min(espera + 0.05, 60))


class Servidor:
    def __init__(self, concurrencia, limitador=None):
        self.semaforo = threading.BoundedSemaphore(concurrencia)
        self.concurrencia = concurrencia
        self.limitador = limitador


SERVIDORES = {
    "power.larc.nasa.gov": Servidor(4),
    "archive-api.open-meteo.com": Servidor(
        2, LimitadorPeso([(60, 550), (3600, 4800)])
    ),
    "maps.isric.org": Servidor(8),
}
_POR_DEFECTO = Servidor(4)


def configurar_servidores(power=None, open_meteo=None, soilgrids=None,
                          om_por_minuto=None, om_por_hora=None):
    if power:
        SERVIDORES["power.larc.nasa.gov"] = Servidor(power)
    om = SERVIDORES["archive-api.open-meteo.com"]
    if open_meteo or om_por_minuto or om_por_hora:
        ventanas = [(60, om_por_minuto or 550), (3600, om_por_hora or 4800)]
        SERVIDORES["archive-api.open-meteo.com"] = Servidor(
            open_meteo or om.concurrencia, LimitadorPeso(ventanas)
        )
    if soilgrids:
        SERVIDORES["maps.isric.org"] = Servidor(soilgrids)


def peso_open_meteo(query):
    """weight = nLocations * (nDays/14) * (nVariables/10), conservador (>=1)."""
    try:
        d0 = dt.date.fromisoformat(query["start_date"])
        d1 = dt.date.fromisoformat(query["end_date"])
        dias = (d1 - d0).days + 1
        nvars = len(str(query.get("hourly", "")).split(","))
    except Exception:
        return 1.0
    return max(1.0, dias / 14) * max(1.0, nvars / 10)


# ---------------------------------------------------------------------------
# Caché en disco + memoria
# ---------------------------------------------------------------------------

def _identificador(url):
    return hashlib.sha256(url.encode()).hexdigest()[:24]


def _escribir_atomico(path, data):
    tmp = path.with_name(path.name + f".tmp{os.getpid()}_{threading.get_ident()}")
    if isinstance(data, str):
        tmp.write_text(data, encoding="utf-8")
    else:
        tmp.write_bytes(data)
    os.replace(tmp, path)


class LRU:
    def __init__(self, tam):
        self.tam = tam
        self.d = collections.OrderedDict()
        self.lock = threading.Lock()

    def get(self, clave, fabrica):
        with self.lock:
            if clave in self.d:
                self.d.move_to_end(clave)
                return self.d[clave]
        valor = fabrica()
        with self.lock:
            self.d[clave] = valor
            self.d.move_to_end(clave)
            while len(self.d) > self.tam:
                self.d.popitem(last=False)
        return valor


class Cache:
    """Mismo formato de caché que el original (sha256(url)[:24])."""

    def __init__(self, raw, offline=False, reintentos=4, esperas_429=40,
                 tam_memoria=24):
        self.raw = Path(raw)
        self.raw.mkdir(parents=True, exist_ok=True)
        self.offline = offline
        self.reintentos = reintentos
        self.esperas_429 = esperas_429
        self.memoria = LRU(tam_memoria)
        self._locks = collections.defaultdict(threading.Lock)
        self._meta = threading.Lock()
        self.descargas = 0

    def _lock(self, clave):
        with self._meta:
            return self._locks[clave]

    # -- descarga con reintentos ------------------------------------------
    def _bajar(self, url, timeout, agente, peso=1.0, validar=None):
        host = urllib.parse.urlsplit(url).hostname
        srv = SERVIDORES.get(host, _POR_DEFECTO)
        intento = esperas = 0
        ultimo = ""
        while True:
            if srv.limitador:
                srv.limitador.adquirir(peso)
            espera = None
            with srv.semaforo:
                try:
                    status, cuerpo, headers = _descargar(url, timeout, agente)
                except _ErrorRed as exc:
                    status, ultimo = None, str(exc)
            if status == 200:
                if validar is None or validar(cuerpo):
                    self.descargas += 1
                    return cuerpo
                ultimo = "respuesta 200 con contenido invalido"
            elif status == 429:
                texto = cuerpo.decode("utf-8", "ignore")
                if "daily" in texto.lower():
                    raise LimiteDiario(texto.strip()[:300])
                esperas += 1
                if esperas > self.esperas_429:
                    raise FuenteNoDisponible("HTTP 429 persistente: " + texto[:200])
                try:
                    espera = float(headers.get("Retry-After"))
                except (TypeError, ValueError):
                    espera = 300 if "hour" in texto.lower() else 60
                time.sleep(espera)
                continue
            elif status is not None and status < 500:
                motivo = cuerpo.decode("utf-8", "ignore").strip()[:300]
                raise ErrorPermanente(f"HTTP Error {status}: {motivo}")
            elif status is not None:
                ultimo = f"HTTP Error {status}"
            if intento >= self.reintentos:
                raise FuenteNoDisponible(ultimo)
            time.sleep(2 ** intento)
            intento += 1

    def _error_guardado(self, ident):
        f = self.raw / f"{ident}.error"
        if f.exists():
            raise ErrorPermanente(f.read_text(encoding="utf-8"))

    # -- JSON (POWER, Open-Meteo) -----------------------------------------
    def json(self, base, query, agente="AndesAnalogos/4.0", timeout=75):
        url = base + "?" + urllib.parse.urlencode(query)
        return self.memoria.get(
            url, lambda: self._json_disco(url, base, query, agente, timeout)
        ), url

    def _json_disco(self, url, base, query, agente, timeout):
        ident = _identificador(url)
        file = self.raw / f"{ident}.json"
        if file.exists():
            return json.loads(file.read_text(encoding="utf-8"))["respuesta"]
        with self._lock(ident):
            if file.exists():
                return json.loads(file.read_text(encoding="utf-8"))["respuesta"]
            self._error_guardado(ident)
            if self.offline:
                raise FuenteNoDisponible("Sin caché (fase de cálculo): " + url)
            peso = peso_open_meteo(query) if base == ERA else 1.0

            def valido(cuerpo):
                try:
                    json.loads(cuerpo)
                    return True
                except ValueError:
                    return False
            try:
                cuerpo = self._bajar(url, timeout, agente, peso, valido)
            except ErrorPermanente as exc:
                _escribir_atomico(self.raw / f"{ident}.error", str(exc))
                raise
            data = json.loads(cuerpo)
            _escribir_atomico(file, json.dumps({
                "url": url,
                "fecha_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                "respuesta": data,
            }, ensure_ascii=False))
            return data

    # -- GeoTIFF (SoilGrids WCS) ------------------------------------------
    def tif(self, url, agente="AndesPending/5.0", timeout=45):
        ident = _identificador(url)
        file = self.raw / f"{ident}.tif"
        if file.exists():
            return file.read_bytes()
        with self._lock(ident):
            if file.exists():
                return file.read_bytes()
            self._error_guardado(ident)
            if self.offline:
                raise FuenteNoDisponible("Sin caché (fase de cálculo): " + url)
            try:
                cuerpo = self._bajar(
                    url, timeout, agente,
                    validar=lambda b: b[:4] in (b"II*\x00", b"MM\x00*"),
                )
            except ErrorPermanente as exc:
                _escribir_atomico(self.raw / f"{ident}.error", str(exc))
                raise
            _escribir_atomico(file, cuerpo)
            _escribir_atomico(file.with_suffix(".json"), json.dumps({
                "url": url,
                "fecha_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
            }))
            return cuerpo

    def memo(self, clave, fabrica):
        return self.memoria.get(clave, fabrica)


# ---------------------------------------------------------------------------
# Consultas (las mismas que el original; con agrupado opcional por celda)
# ---------------------------------------------------------------------------

def clave_power(lat, lon):
    # MERRA-2 (0.5° x 0.625°, centros en múltiplos) + CERES (1°, centros en .5)
    return (
        round((lat + 90) / 0.5), round((lon + 180) / 0.625),
        math.floor(lat), math.floor(lon),
    )


def clave_era(lat, lon):
    return (round(lat, 1), round(lon, 1))


class Contexto:
    def __init__(self, raw, h, cobertura=1.0, sin_hipotesis=False,
                 local=None, agrupar=True, offline=False, sitios=(),
                 sin_era5=False):
        self.raw = Path(raw)
        self.h = h
        self.cobertura = cobertura
        self.sin_hipotesis = sin_hipotesis
        self.local = local or {}
        self.agrupar = agrupar
        self.sin_era5 = sin_era5
        self.cache = Cache(self.raw, offline=offline)
        # Representante estable de cada celda POWER: primer sitio del CSV.
        self.rep_power = {}
        for s in sitios:
            self.rep_power.setdefault(
                clave_power(s["lat"], s["lon"]), (s["lat"], s["lon"])
            )
        catalog = self.raw.parent / "fuentes_pendientes.json"
        if not catalog.exists():
            try:
                _escribir_atomico(catalog, json.dumps(
                    CATALOGO, ensure_ascii=False, indent=2))
            except OSError:
                pass

    def q_power(self, site, year):
        lat, lon = site["lat"], site["lon"]
        if self.agrupar:
            lat, lon = self.rep_power.setdefault(
                clave_power(lat, lon), (lat, lon))
        return {
            "parameters": ",".join(NASA),
            "community": "RE",
            "latitude": lat,
            "longitude": lon,
            "start": f"{year}0101",
            "end": f"{year}1231",
            "format": "JSON",
            "time-standard": "UTC",
        }

    def q_era(self, site, year):
        lat, lon = site["lat"], site["lon"]
        if self.agrupar:
            lat, lon = clave_era(lat, lon)
        return {
            "latitude": lat,
            "longitude": lon,
            "start_date": f"{year}-01-01",
            "end_date": f"{year}-12-31",
            "hourly": ",".join(ERA_VARS),
            "models": "era5_land",
            "timezone": "UTC",
            "elevation": "nan",
        }

    def urls_sitio(self, site, year):
        """URLs que necesita un sitio-año (para la fase de descarga)."""
        x, y = pixel_igh(site["lat"], site["lon"])
        return {
            "power": [(POWER, self.q_power(site, year))],
            "era": [] if self.sin_era5 else [(ERA, self.q_era(site, year))],
            "soil": [url_wcs(p, x, y) for p in SOIL_PROPS],
        }


def _transformador():
    t = getattr(_hilo, "igh", None)
    if t is None:
        from pyproj import Transformer
        t = Transformer.from_crs(
            "EPSG:4326",
            "+proj=igh +datum=WGS84 +units=m +no_defs",
            always_xy=True,
        )
        _hilo.igh = t
    return t


def pixel_igh(lat, lon):
    x, y = _transformador().transform(lon, lat)
    x = -19949000 + (math.floor((x + 19949000) / 250) + 0.5) * 250
    y = 8361000 - (math.floor((8361000 - y) / 250) + 0.5) * 250
    return x, y


def url_wcs(prop, x, y):
    query = [
        ("map", f"/map/{prop}.map"),
        ("SERVICE", "WCS"),
        ("VERSION", "2.0.1"),
        ("REQUEST", "GetCoverage"),
        ("COVERAGEID", f"{prop}_0-5cm_mean"),
        ("FORMAT", "image/tiff"),
        ("SUBSET", f"x({x-125},{x+125})"),
        ("SUBSET", f"y({y-125},{y+125})"),
    ]
    return "https://maps.isric.org/mapserv?" + urllib.parse.urlencode(query)


def _media(a):
    return math.fsum(a) / len(a)


# ---------------------------------------------------------------------------
# Procesamiento de un sitio-año (port fiel del bucle del original)
# ---------------------------------------------------------------------------

def procesar_sitio(site, year, ctx):
    """Devuelve (rows, errors) con las mismas filas que el original."""
    h = ctx.h
    rows, errors = [], []
    days = 366 if calendar.isleap(year) else 365
    real = {}

    def emit(parameter, value, state, source, note, scope="sitio",
             low="", high="", count="", expected=""):
        row = {
            "sitio": site["sitio"],
            "lat": site["lat"],
            "lon": site["lon"],
            "anio": year,
            "etapa": CAT[parameter][0],
            "parametro": parameter,
            "valor": value,
            "unidad": CAT[parameter][1],
            "estado": state,
            "ambito": scope,
            "minimo": low,
            "maximo": high,
            "muestras_validas": count,
            "muestras_esperadas": expected,
            "fuente": source,
            "justificacion": note,
            "referencia_marte": CAT[parameter][2],
        }
        rows.append(row)
        if scope == "sitio":
            real[parameter] = row

    def error(fuente, exc):
        if isinstance(exc, LimiteDiario):
            raise exc
        errors.append({
            "sitio": site["sitio"], "anio": year,
            "fuente": fuente, "error": str(exc), **marca_transitorio(exc),
        })

    # --- NASA POWER --------------------------------------------------------
    try:
        data, url = ctx.cache.json(POWER, ctx.q_power(site, year))
        series = {}
        for code, (parameter, unit, factor, offset) in NASA.items():
            if data["parameters"][code]["units"] != unit:
                raise ValueError("Unidad NASA: " + code)
            series[code] = {
                day: value * factor + offset
                for day, value in
                data["properties"]["parameter"][code].items()
                if (
                    str(day).startswith(str(year))
                    and isinstance(value, (int, float))
                    and math.isfinite(value)
                    and value != data["header"]["fill_value"]
                )
            }

        def mean(parameter, values, state, note):
            sufficient = bool(values) and len(values) >= days * ctx.cobertura
            emit(
                parameter,
                statistics.mean(values) if sufficient else "",
                state if sufficient else "cobertura_insuficiente",
                url, note, count=len(values), expected=days,
            )

        for code, (parameter, _, _, _) in NASA.items():
            if parameter:
                mean(
                    parameter, list(series[code].values()), "modelo_NASA",
                    code + "; media diaria anual; celda regional, "
                    "no medicion local.",
                )

        densities, pressures = [], []
        common = set.intersection(*(
            set(series[code]) for code in ["T2M", "QV2M", "PS"]
        ))
        for day in common:
            temperature = series["T2M"][day]
            humidity = series["QV2M"][day]
            pressure = series["PS"][day]
            if temperature > 0 and pressure > 0 and 0 <= humidity < 1:
                virtual_t = temperature * (1 + 0.608 * humidity)
                densities.append(pressure / (287.05 * virtual_t))
                pressures.append(
                    pressure * math.exp(-9.81 * 10 / (287.05 * virtual_t))
                )
        mean(
            "rho_aire", densities, "estimacion_atmosferica",
            "P/(Rd*Tv), Tv=T*(1+0.608q); T y q a 2 m; medias diarias.",
        )
        mean(
            "p_aire_10m", pressures, "estimacion_hidrostatica",
            "Ps*exp(-g*10/(Rd*Tv)); capa isoterma; NO cavidad.",
        )
    except Exception as exc:
        error("NASA", exc)

    # --- ERA5-Land (una sola consulta para las 5 variables) ---------------
    era = era_url = arr = era_exc = None
    try:
        if ctx.sin_era5:
            raise ValueError("ERA5-Land omitida (--sin-era5)")
        era, era_url = ctx.cache.json(ERA, ctx.q_era(site, year))
        arr = ctx.cache.memo(("np", era_url), lambda: {
            v: np.asarray(era["hourly"][v], dtype=float) for v in ERA_VARS
        })
    except Exception as exc:
        if isinstance(exc, LimiteDiario):
            raise
        era_exc = exc

    try:
        if era_exc is not None:
            raise era_exc
        for layer in LAYERS:
            code = "soil_temperature_" + layer
            if era["hourly_units"][code] != "°C":
                raise ValueError("Unidad ERA5 inesperada")
            a = arr[code]
            values = a[np.isfinite(a)] + 273.15
            sufficient = (
                values.size > 0
                and values.size >= days * 24 * ctx.cobertura
            )
            emit(
                "t_suelo_" + layer,
                _media(values) if sufficient else "",
                "modelo_ERA5_Land" if sufficient else "cobertura_insuficiente",
                era_url,
                f"Capa {layer}; NO prueba hielo. "
                f"Celda {era['latitude']},{era['longitude']}; "
                "sin ajuste altitudinal.",
                count=int(values.size), expected=days * 24,
            )
    except Exception as exc:
        error("ERA5-Land/Open-Meteo", exc)

    # --- SoilGrids + modelo térmico ---------------------------------------
    _suelo(site, year, ctx, emit, errors, error, era, era_url, arr, era_exc)

    # --- Datos locales ----------------------------------------------------
    for (name, local_year, parameter), (value, kind, source, note) in \
            ctx.local.items():
        if name == site["sitio"] and local_year == year:
            rows[:] = [
                row for row in rows
                if not (
                    row["sitio"] == name and row["anio"] == year
                    and row["parametro"] == parameter
                    and row["ambito"] == "sitio"
                )
            ]
            emit(parameter, value, "local_" + kind, source, note)

    for parameter in CAT:
        if parameter not in real:
            emit(parameter, "", "pendiente", "",
                 "Sin informacion local suficiente.")

    if not ctx.sin_hipotesis:
        _escenarios(h, real, emit)

    return rows, errors


def _suelo(site, year, ctx, emit, errors, error, era, era_url, arr, era_exc):
    values, sources = {}, []
    x, y = pixel_igh(site["lat"], site["lon"])

    from rasterio.io import MemoryFile

    for prop in SOIL_PROPS:
        url = url_wcs(prop, x, y)
        try:
            body = ctx.cache.tif(url)
            with MemoryFile(body) as memory:
                with memory.open() as dataset:
                    sample = next(dataset.sample([(x, y)], masked=True))[0]
                    if (
                        getattr(sample, "mask", False)
                        or not math.isfinite(float(sample))
                    ):
                        raise ValueError("Pixel sin datos")
                    values[prop] = float(sample)
            sources.append(url)
        except Exception as exc:
            error("SoilGrids WCS " + prop, exc)

    source = " | ".join(sources)

    def add(parameter, value, note):
        emit(parameter, value, "modelo_SoilGrids", source, note)

    if "bdod" in values:
        density = values["bdod"] * 10
        if 0 < density < 2650:
            add("rho_tierra_fina", density,
                "Densidad seca de tierra fina 0-5 cm; "
                "prediccion 250 m, no hielo.")
    if "cfvo" in values:
        coarse = values["cfvo"] / 1000
        if 0 <= coarse <= 1:
            add("fragmentos_gruesos_suelo", coarse,
                "Fraccion >2 mm; NO detritos dentro del hielo.")
    for key, name, factor in [
        ("sand", "arena_suelo", 0.001),
        ("clay", "arcilla_suelo", 0.001),
        ("soc", "carbono_organico_suelo", 0.0001),
    ]:
        if key in values:
            add(name, values[key] * factor,
                "Fraccion masica en tierra fina, 0-5 cm. "
                "NO composicion del cuerpo de hielo.")

    if not all(prop in values for prop in ["bdod", "cfvo", "soc"]):
        return

    density = values["bdod"] * 10
    coarse = values["cfvo"] / 1000
    carbon = values["soc"] / 10000
    if not (0 < density < 2650 and 0 <= coarse <= 1 and carbon <= 0.05):
        errors.append({
            "sitio": site["sitio"], "anio": year,
            "fuente": "Modelo termico",
            "error": (
                "Fuera del dominio mineral implementado o "
                "carbono organico >5%. No se estima k ni I."
            ),
        })
        return

    bulk = (1 - coarse) * density + coarse * 2650
    porosity = 1 - bulk / 2650
    if porosity <= 0:
        return

    emit("rho_cobertura", bulk, "estimacion_suelo_mineral", source,
         "Densidad seca estimada 0-5 cm; particulas "
         "2650 kg/m3 y fragmentos sin poros internos.")

    try:
        if era_exc is not None:
            raise era_exc
        units = era["hourly_units"]
        if (
            units["soil_temperature_0_to_7cm"] != "°C"
            or units["soil_moisture_0_to_7cm"] != "m³/m³"
        ):
            raise ValueError("Unidades ERA5-Land inesperadas")

        dry_k = (0.135 * bulk + 64.7) / (2700 - 0.947 * bulk)
        T = arr["soil_temperature_0_to_7cm"]
        M = arr["soil_moisture_0_to_7cm"]
        n = min(T.size, M.size)
        T, M = T[:n], M[:n]
        with np.errstate(invalid="ignore"):
            ok = (np.isfinite(T) & np.isfinite(M)
                  & (M >= 0) & (M <= porosity))
        T, M = T[ok], M[ok]

        saturation = M / porosity
        frozen = T < 0
        coefficient = 0.7 if values.get("sand", 0) >= 500 else 1.0
        kersten = np.where(
            frozen, saturation,
            np.clip(coefficient * np.log10(np.maximum(saturation, 1e-12)) + 1,
                    0, 1),
        )
        sat_low = np.where(frozen,
                           2.0 ** (1 - porosity) * 2.3 ** porosity,
                           2.0 ** (1 - porosity) * 0.57 ** porosity)
        sat_high = np.where(frozen,
                            7.7 ** (1 - porosity) * 2.3 ** porosity,
                            7.7 ** (1 - porosity) * 0.57 ** porosity)
        lower = dry_k + (sat_low - dry_k) * kersten
        upper = dry_k + (sat_high - dry_k) * kersten
        capacity = bulk * 800 + M * np.where(frozen, 917 * 2000, 1000 * 4180)

        count = int(T.size)
        expected = (366 if calendar.isleap(year) else 365) * 24
        note = (
            f"SoilGrids 0-5 cm + ERA5-Land 0-7 cm: "
            f"{count}/{expected} horas compatibles. "
            "Johansen: k=kd+(ksat-kd)*Ke. "
            "k mineral supuesto 2-7.7 W/(m K); "
            "cp mineral=800 J/(kg K). Bajo 0 C se supone "
            "congelada el agua modelada; no considera agua "
            "no congelada ni calor latente. "
            "Se excluyen horas con humedad >porosidad. "
            "Resoluciones espaciales distintas; intervalo "
            "de supuestos, NO confianza estadistica "
            "ni propiedades de hielo masivo."
        )
        if count and count >= ctx.cobertura * expected:
            fuente = source + " | " + era_url + " | " + THERMAL
            emit("k_cobertura", "", "estimacion_termica_condicionada",
                 fuente, note, low=_media(lower), high=_media(upper),
                 count=count, expected=expected)
            emit("inercia_cobertura", "", "estimacion_termica_condicionada",
                 fuente, note + " I=sqrt(k*Cvol), calculado hora a hora.",
                 low=_media(np.sqrt(lower * capacity)),
                 high=_media(np.sqrt(upper * capacity)),
                 count=count, expected=expected)
        else:
            errors.append({
                "sitio": site["sitio"], "anio": year,
                "fuente": "Modelo termico",
                "error": note + " Cobertura insuficiente.",
            })
    except Exception as exc:
        error("ERA5-Land humedad/modelo termico", exc)


def _escenarios(h, real, emit):
    def observed(parameter, default):
        value = real.get(parameter, {}).get("valor", "")
        return value if isinstance(value, (int, float)) else default

    def scenario(parameter, value, note, low="", high="",
                 source="hipotesis_usadas.json"):
        emit(parameter, value, "HIPOTESIS_NO_MEDICION_LOCAL",
             source, note, "escenario", low, high)

    temperature = observed("t_hielo", h["t_hielo_K"])
    debris = observed("detritos_v", h["detritos_v"])
    porosity = h["porosidad_gas"]

    scenario("t_hielo", temperature,
             "Dato local si existe; de lo contrario "
             "temperatura impuesta de ensayo, NO inferida del clima.")
    scenario("detritos_v", debris,
             "Dato local si existe; de lo contrario "
             "mezcla supuesta para ensayo. Volumen sin poros gaseosos.")

    density = observed(
        "rho_cuerpo",
        (1 - porosity) * (
            (1 - debris) * h["rho_hielo"] + debris * h["rho_detritos"]
        ),
    )
    scenario("rho_cuerpo", density,
             "Dato local si existe; si no "
             "(1-phi)*[(1-fd)*rho_hielo+fd*rho_detritos]. "
             "Poros con gas, sin liquido.")

    if 233.15 <= temperature <= 273.15:
        ice_k = 567 / temperature
        debris_k = h["k_detritos"]
        minimum_k = 1 / (
            (1 - porosity) * ((1 - debris) / ice_k + debris / debris_k)
            + porosity / 0.024
        )
        maximum_k = (
            (1 - porosity) * ((1 - debris) * ice_k + debris * debris_k)
            + porosity * 0.024
        )
        scenario("k_cuerpo", "",
                 "567/T para hielo; limites serie/paralelo "
                 "de mezcla; k_gas=0.024. No se conoce su geometria.",
                 minimum_k, maximum_k)
    else:
        scenario("k_cuerpo", "",
                 "Temperatura local fuera del rango "
                 "implementado; requiere otra parametrizacion.")

    bulk = observed("rho_cobertura", h["rho_cobertura_fallback"])
    if 0 < bulk < 2650:
        soil_porosity = 1 - bulk / 2650
        minimum_k = (0.135 * bulk + 64.7) / (2700 - 0.947 * bulk)
        maximum_k = 7.7 ** (1 - soil_porosity) * 2.3 ** soil_porosity
        note = (
            "Escenario de suelo mineral: seco a "
            "saturado congelado; k_mineral hasta 7.7, "
            "k_hielo=2.3. NO intervalo estadistico ni promedio anual."
        )
        scenario("k_cobertura", "", note, minimum_k, maximum_k, THERMAL)
        scenario("inercia_cobertura", "",
                 note + " I=sqrt(k*Cvol); cp_mineral supuesto "
                 "700-1000; aporte agua hasta por*4.18e6.",
                 math.sqrt(minimum_k * bulk * 700),
                 math.sqrt(maximum_k * (bulk * 1000 + soil_porosity * 4.18e6)),
                 THERMAL)
    else:
        scenario("k_cobertura", "",
                 "Densidad local incompatible con el "
                 "escenario mineral; requiere modelo especifico.")
        scenario("inercia_cobertura", "",
                 "Faltan propiedades compatibles de la cobertura.")

    scenario("sobrecarga", density * 9.81 * h["profundidad_m"],
             "rho*g*h; columna uniforme terrestre. "
             "No incluye otra cobertura ni atmosfera.")

    ambient = observed("p_superficie", None)
    pressure = (None if ambient is None
                else ambient + h["sobrepresion_operacion_Pa"])
    scenario("p_operacion", pressure if pressure is not None else "",
             "Patm + sobrepresion impuesta; "
             "NO calculo de diseno, ni presion admisible de cavidad.")

    perchlorate = observed("perclorato", h["perclorato_wt_pct"])
    scenario("perclorato", perchlorate,
             "Dato local si existe; si no supuesto "
             "inspirado en Phoenix, SIN evidencia de "
             "presencia en Argentina. wt% de anion ClO4 en detrito seco.")

    osmoles = (
        3 * (perchlorate / 100) * h["fraccion_sal_disuelta"]
        / (2 * 0.09945 * h["agua_kg_por_kg_detrito"])
    )
    if osmoles <= 0.1 and pressure is not None and 611 < pressure <= 5e6:
        freezing = 273.15 - 1.86 * osmoles - 7.4e-8 * (pressure - 101325)
        scenario("t_congelacion", freezing,
                 "Sal supuesta Mg(ClO4)2; disolucion "
                 "segun balance de anion y agua. "
                 "Tf=273.15-1.86*osmoles-7.4e-8*(P-101325). "
                 "Ideal diluido; no eutectico. "
                 "Correccion de presion lineal aproximada del hielo I.",
                 source=FREEZE)
    else:
        scenario("t_congelacion", "",
                 "Fuera del dominio ideal diluido "
                 "o sin presion: requiere diagrama "
                 "de fases; NO se extrapola a 206 K.")


# ---------------------------------------------------------------------------
# Motor paralelo: 1) descargas por servidor en paralelo  2) cálculo multiproceso
# ---------------------------------------------------------------------------

def descargar_todo(sitios, anios, ctx, progreso=True):
    """Baja (o confirma en caché) todo lo necesario. Devuelve un resumen."""
    from concurrent.futures import ThreadPoolExecutor, wait

    trabajos = {"power": {}, "era": {}, "soil": {}}
    for s in sitios:
        for y in anios:
            u = ctx.urls_sitio(s, y)
            for base, q in u["power"]:
                trabajos["power"][base + "?" + urllib.parse.urlencode(q)] = (base, q)
            for base, q in u["era"]:
                trabajos["era"][base + "?" + urllib.parse.urlencode(q)] = (base, q)
            for url in u["soil"]:
                trabajos["soil"][url] = url

    def pendiente(tipo, url):
        ext = ".tif" if tipo == "soil" else ".json"
        ident = _identificador(url)
        return not (ctx.raw / f"{ident}{ext}").exists() and \
            not (ctx.raw / f"{ident}.error").exists()

    resumen = {}
    detener_era = threading.Event()
    lock = threading.Lock()
    hechos = collections.Counter()
    fallidos = collections.Counter()
    t0 = time.time()

    def tarea(tipo, item):
        if tipo == "era" and detener_era.is_set():
            return
        try:
            if tipo == "soil":
                ctx.cache.tif(item)
            else:
                ctx.cache.json(*item)
        except LimiteDiario as exc:
            if not detener_era.is_set():
                print("\n[Open-Meteo] Límite DIARIO alcanzado; se detiene ERA5 "
                      "(lo ya bajado queda en caché). Volver a correr mañana.\n",
                      exc, flush=True)
            detener_era.set()
            with lock:
                fallidos[tipo] += 1
            return
        except Exception:
            with lock:
                fallidos[tipo] += 1
        with lock:
            hechos[tipo] += 1
            total = sum(len(v) for v in pend.values())
            n = sum(hechos.values())
            if progreso and (n % 50 == 0 or n == total):
                dt_ = time.time() - t0
                print(f"  descargas {n}/{total}  "
                      f"[POWER {hechos['power']}/{len(pend['power'])}, "
                      f"ERA5 {hechos['era']}/{len(pend['era'])}, "
                      f"SoilGrids {hechos['soil']}/{len(pend['soil'])}]  "
                      f"{n / max(dt_, 1e-9):.1f}/s", flush=True)

    pend = {
        tipo: [item for url, item in d.items() if pendiente(tipo, url)]
        for tipo, d in trabajos.items()
    }
    for tipo in trabajos:
        resumen[tipo] = {"unicos": len(trabajos[tipo]),
                         "a_descargar": len(pend[tipo])}
    if progreso:
        print("Consultas únicas (en caché / a bajar):", flush=True)
        for tipo, r in resumen.items():
            print(f"  {tipo:5s}: {r['unicos'] - r['a_descargar']} / "
                  f"{r['a_descargar']}", flush=True)

    hosts = {"power": "power.larc.nasa.gov",
             "era": "archive-api.open-meteo.com",
             "soil": "maps.isric.org"}
    ejecutores, futuros = [], []
    for tipo, items in pend.items():
        if not items:
            continue
        n = SERVIDORES[hosts[tipo]].concurrencia
        ex = ThreadPoolExecutor(max_workers=n, thread_name_prefix=tipo)
        ejecutores.append(ex)
        futuros += [ex.submit(tarea, tipo, it) for it in items]
    try:
        wait(futuros)
    except KeyboardInterrupt:
        detener_era.set()
        for ex in ejecutores:
            ex.shutdown(wait=False, cancel_futures=True)
        raise
    for ex in ejecutores:
        ex.shutdown()
    for tipo in resumen:
        resumen[tipo]["fallidos"] = fallidos[tipo]
    resumen["limite_diario_open_meteo"] = detener_era.is_set()
    return resumen


_CTX_PROCESO = None


def _init_proceso(kwargs):
    global _CTX_PROCESO
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    _CTX_PROCESO = Contexto(**kwargs)


def _trabajo(args):
    i, site, year = args
    rows, errors = procesar_sitio(site, year, _CTX_PROCESO)
    return i, year, rows, errors


def orden_localidad(sitios):
    """Ordena por celda ERA5 y POWER para aprovechar la caché en memoria."""
    return sorted(
        range(len(sitios)),
        key=lambda i: (clave_era(sitios[i]["lat"], sitios[i]["lon"]),
                       clave_power(sitios[i]["lat"], sitios[i]["lon"])),
    )


def calcular_todo(sitios, anios, ctx_kwargs, procesos=None, indices=None):
    """Genera (indice, anio, rows, errors) usando varios procesos, sólo con caché."""
    from concurrent.futures import ProcessPoolExecutor
    import multiprocessing as mp

    procesos = procesos or os.cpu_count() or 1
    kwargs = dict(ctx_kwargs, offline=True)
    orden = indices if indices is not None else orden_localidad(sitios)
    tareas = [(i, sitios[i], y) for i in orden for y in anios]
    if procesos <= 1:
        _init_proceso(kwargs)
        for t in tareas:
            yield _trabajo(t)
        return
    with ProcessPoolExecutor(
        max_workers=procesos, mp_context=mp.get_context("fork"),
        initializer=_init_proceso, initargs=(kwargs,),
    ) as ex:
        yield from ex.map(_trabajo, tareas, chunksize=16)


# ---------------------------------------------------------------------------
# CLI compatible con el original (+ opciones de rendimiento)
# ---------------------------------------------------------------------------

def validar_hipotesis(h, error):
    if not all(isinstance(v, (int, float)) and math.isfinite(v)
               for v in h.values()):
        error("Las hipotesis deben ser numeros finitos.")
    if not (
        233.15 <= h["t_hielo_K"] <= 273.15
        and 0 <= h["detritos_v"] <= 1
        and 0 <= h["porosidad_gas"] < 1
        and 0 <= h["fraccion_sal_disuelta"] <= 1
        and 0 <= h["perclorato_wt_pct"] < 100
        and h["profundidad_m"] >= 0
        and h["sobrepresion_operacion_Pa"] >= 0
        and all(h[k] > 0 for k in ["rho_hielo", "rho_detritos",
                                   "k_detritos", "agua_kg_por_kg_detrito"])
        and 0 < h["rho_cobertura_fallback"] < 2650
    ):
        error("Hipotesis fuera de rango.")


def leer_sitios(path, error):
    with open(path, encoding="utf-8-sig", newline="") as archivo:
        sites = list(csv.DictReader(archivo))
    names = set()
    for site in sites:
        site["lat"] = float(site["lat"])
        site["lon"] = float(site["lon"])
        if (not site["sitio"].strip() or site["sitio"] in names
                or not (-90 <= site["lat"] <= 90
                        and -180 <= site["lon"] <= 180)):
            error("Nombres duplicados/vacios o coordenadas invalidas.")
        names.add(site["sitio"])
    if not sites:
        error("No hay sitios.")
    return sites, names


def leer_locales(path, names, desde, hasta, error):
    local = {}
    allow_zero = {"detritos_v", "fragmentos_gruesos_suelo", "perclorato",
                  "z0", "viento_10m", "solar", "sobrecarga"}
    atmospheric = {"t_superficie", "p_superficie", "viento_10m", "solar",
                   "rho_aire", "p_aire_10m"}
    with open(path, encoding="utf-8-sig", newline="") as archivo:
        for row in csv.DictReader(archivo):
            if not row["valor"].strip():
                continue
            parameter = row["parametro"]
            year = int(row["anio"])
            value = float(row["valor"])
            if (parameter not in CAT or row["unidad"] != CAT[parameter][1]
                    or row["sitio"] not in names
                    or not desde <= year <= hasta
                    or not math.isfinite(value) or value < 0
                    or not row["fuente"].strip()
                    or not row["contexto"].strip()):
                error("Dato local invalido: " + str(row))
            if value == 0 and parameter not in allow_zero:
                error("Propiedad local debe ser positiva: " + parameter)
            if (parameter in ("detritos_v", "fragmentos_gruesos_suelo")
                    and value > 1):
                error("Fracciones locales: usar 0-1.")
            if parameter.startswith("t_") and value <= 0:
                error("Temperaturas: kelvin >0.")
            if parameter == "perclorato" and value >= 100:
                error("Perclorato: wt%, menor que 100.")
            if row["tipo"] not in ("media_anual", "puntual", "propiedad",
                                   "estimacion", "diseno"):
                error("Tipo local no reconocido.")
            if parameter in atmospheric and row["tipo"] != "media_anual":
                error("Variables atmosfericas/superficie "
                      "requieren media_anual.")
            key = (row["sitio"], year, parameter)
            if key in local:
                error("Dato local duplicado.")
            local[key] = (value, row["tipo"], row["fuente"], row["contexto"])
    return local


FIELDS = [
    "sitio", "lat", "lon", "anio", "etapa", "parametro", "valor", "unidad",
    "estado", "ambito", "minimo", "maximo", "muestras_validas",
    "muestras_esperadas", "fuente", "justificacion", "referencia_marte",
]


def agregar_args_rendimiento(parser):
    g = parser.add_argument_group("rendimiento")
    g.add_argument("--procesos", type=int, default=os.cpu_count(),
                   help="procesos para la fase de cálculo (def: núcleos)")
    g.add_argument("--exacto", action="store_true",
                   help="no agrupar por celda: una consulta por coordenada")
    g.add_argument("--conc-power", type=int, default=4)
    g.add_argument("--conc-open-meteo", type=int, default=2)
    g.add_argument("--conc-soilgrids", type=int, default=8)
    g.add_argument("--om-peso-minuto", type=float, default=550)
    g.add_argument("--om-peso-hora", type=float, default=4800)


def aplicar_args_rendimiento(args):
    configurar_servidores(
        power=args.conc_power, open_meteo=args.conc_open_meteo,
        soilgrids=args.conc_soilgrids,
        om_por_minuto=args.om_peso_minuto, om_por_hora=args.om_peso_hora,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sitios", help="CSV: sitio,lat,lon")
    parser.add_argument("--desde", type=int, default=2024)
    parser.add_argument("--hasta", type=int, default=2024)
    parser.add_argument("--salida", default="resultados_unificados")
    parser.add_argument("--hipotesis")
    parser.add_argument("--locales")
    parser.add_argument("--sin-hipotesis", action="store_true")
    parser.add_argument("--cobertura", type=float, default=1.0)
    agregar_args_rendimiento(parser)
    args = parser.parse_args()

    if not (1984 <= args.desde <= args.hasta < dt.date.today().year
            and 0 < args.cobertura <= 1):
        parser.error("Usar anos completos desde 1984 y cobertura en (0,1].")

    h = DEFAULTS.copy()
    if args.hipotesis:
        changes = json.loads(Path(args.hipotesis).read_text(encoding="utf-8-sig"))
        unknown = set(changes) - set(h)
        if unknown:
            parser.error("Hipotesis desconocidas: " + str(unknown))
        h.update(changes)
    validar_hipotesis(h, parser.error)

    sites, names = leer_sitios(args.sitios, parser.error)
    local = (leer_locales(args.locales, names, args.desde, args.hasta,
                          parser.error) if args.locales else {})
    aplicar_args_rendimiento(args)

    output = Path(args.salida)
    raw = output / "fuentes_originales"
    raw.mkdir(parents=True, exist_ok=True)
    (output / "hipotesis_usadas.json").write_text(
        json.dumps(h, indent=2), encoding="utf-8")

    anios = list(range(args.desde, args.hasta + 1))
    kwargs = dict(raw=raw, h=h, cobertura=args.cobertura,
                  sin_hipotesis=args.sin_hipotesis, local=local,
                  agrupar=not args.exacto, sitios=sites)
    descargar_todo(sites, anios, Contexto(**kwargs))

    resultados = {}
    for i, year, rows, errs in calcular_todo(sites, anios, kwargs,
                                             args.procesos):
        resultados[(i, year)] = (rows, errs)
    rows, errors = [], []
    for i in range(len(sites)):
        for year in anios:
            r, e = resultados[(i, year)]
            rows += r
            errors += e

    with (output / "comparacion.csv").open(
            "w", encoding="utf-8-sig", newline="") as archivo:
        writer = csv.DictWriter(archivo, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    report = {
        "errores": errors,
        "argumentos": vars(args),
        "hipotesis_activas": not args.sin_hipotesis,
        "hipotesis": h,
        "locales": [{"sitio": k[0], "anio": k[1], "parametro": k[2],
                     "datos": v} for k, v in local.items()],
        "aviso": (
            "Referencias marcianas aportadas, no verificadas. "
            "Escenarios NO demuestran hielo o sales locales. "
            "Propiedades materiales NO son promedios anuales."
        ),
        "fecha_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    (output / "informe.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Salida:", output / "comparacion.csv",
          "; fuentes fallidas:", len(errors))


if __name__ == "__main__":
    main()
