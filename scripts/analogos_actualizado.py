#!/usr/bin/env python3
"""Comparación Andes-Deuteronilus: fuentes e hipótesis separadas."""

import argparse
import calendar
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import statistics
import time
import urllib.parse
import urllib.request


POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
ERA = "https://archive-api.open-meteo.com/v1/archive"
SOIL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
THERMAL = (
    "https://escomp.github.io/ctsm-docs/versions/master/html/"
    "tech_note/Soil_Snow_Temperatures/"
    "CLM50_Tech_Note_Soil_Snow_Temperatures.html"
)
FREEZE = "https://www.chem.purdue.edu/gchelp/solutions/freeze.html"

LAYERS = [
    "0_to_7cm", "7_to_28cm",
    "28_to_100cm", "100_to_255cm",
]

# Parámetro: etapa, unidad, referencia marciana aportada.
# Estas referencias no se verifican automáticamente.
CAT = {
    "z0": ("E1", "m", "0.0044; campo fijo MCD"),
    "t_superficie": (
        "E1", "K", "202; MCD, muestreo aproximado"
    ),
    "k_cuerpo": (
        "E2", "W/(m K)", "2.6-2.8; estimacion hielo con detritos"
    ),
    "k_cobertura": (
        "E2", "W/(m K)", "0.04-0.09; extrapolacion Phoenix/InSight"
    ),
    "t_hielo": ("E2", "K", "202; inferido de superficie"),
    "detritos_v": (
        "E2", "1",
        "<0.20; confirmar base volumetrica de Petersen 2018"
    ),
    "inercia_cobertura": (
        "E2", "J/(m2 K s^0.5)", "195; campo superficial MCD"
    ),
    "p_aire_10m": ("E3", "Pa", "752; atmosfera a +10 m"),
    "p_superficie": ("E3", "Pa", "752; MCD"),
    "rho_aire": ("E3", "kg/m3", "0.020; altura por confirmar"),
    "rho_cuerpo": (
        "E3", "kg/m3", "1200; estimacion, no medicion"
    ),
    "perclorato": (
        "E4", "wt%",
        "0.4-0.6 en Phoenix; NO medido en Deuteronilus"
    ),
    "t_congelacion": (
        "E4", "K",
        "206; eutectico Mg-perclorato ~44 wt%, no diluido"
    ),
    "viento_10m": (
        "E4", "m/s", "6.7; altura MCD por confirmar"
    ),
    "solar": ("E4", "W/m2", "~104; media 24 h aproximada"),
    "sobrecarga": (
        "E3", "Pa", "44520; escenario 1200*3.71*10"
    ),
    "p_operacion": (
        "E3", "Pa", "Sin valor validado: depende del diseno"
    ),
    "rho_tierra_fina": ("E2", "kg/m3", ""),
    "fragmentos_gruesos_suelo": (
        "E2", "1", "NO equivalen a detritos_v del hielo"
    ),
    "rho_cobertura": ("E2", "kg/m3", ""),
}

for layer in LAYERS:
    CAT["t_suelo_" + layer] = (
        "E2", "K",
        "Suelo modelado, NO temperatura medida de hielo"
    )

# Hipótesis de ensayo: no son datos encontrados del sitio.
DEFAULTS = {
    "t_hielo_K": 263.15,
    "detritos_v": 0.10,
    "porosidad_gas": 0.05,
    "rho_hielo": 917.0,
    "rho_detritos": 3000.0,
    "k_detritos": 3.0,
    "profundidad_m": 10.0,
    "rho_cobertura_fallback": 1600.0,
    "perclorato_wt_pct": 0.5,
    "agua_kg_por_kg_detrito": 1.0,
    "fraccion_sal_disuelta": 1.0,
    "sobrepresion_operacion_Pa": 100000.0,
}

# Código NASA: parámetro de salida, unidad, factor, desplazamiento.
NASA = {
    "TS": ("t_superficie", "C", 1, 273.15),
    "PS": ("p_superficie", "kPa", 1000, 0),
    "WS10M": ("viento_10m", "m/s", 1, 0),
    "ALLSKY_SFC_SW_DWN": (
        "solar", "kW-hr/m^2/day", 1000 / 24, 0
    ),
    "Z0M": ("z0", "m", 1, 0),
    "T2M": (None, "C", 1, 273.15),
    "QV2M": (None, "g/kg", 0.001, 0),
}



def suelo_pendiente(site, year, emit, get, raw, errors, coverage):
    import hashlib
    import json
    import math
    import statistics
    import urllib.parse
    import urllib.request
    from rasterio.io import MemoryFile
    from pyproj import Transformer

    catalog = raw.parent / "fuentes_pendientes.json"
    if not catalog.exists():
        catalog.write_text(json.dumps([
            {
                "parametro": "t_hielo",
                "fuente": "https://tc.copernicus.org/articles/19/2653/2025/",
                "estado": (
                    "53 sondeos regionales; datos originales no publicos. "
                    "No se imputan al punto."
                )
            },
            {
                "parametro": "perclorato",
                "fuente": "https://pubmed.ncbi.nlm.nih.gov/24165784/",
                "estado": (
                    "Muestras de Atacama, Chile. No demuestran "
                    "concentracion en puntos argentinos."
                )
            },
            {
                "parametro": "suelo",
                "fuente": "https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html",
                "estado": (
                    "Predicciones SoilGrids consultadas por WCS; "
                    "no describen hielo masivo."
                )
            }
        ], ensure_ascii=False, indent=2), encoding="utf-8")

    properties = ["bdod", "cfvo", "sand", "clay", "soc"]
    values, sources = {}, []

    # CRS nativo de estas capas SoilGrids.
    transformer = Transformer.from_crs(
        "EPSG:4326",
        "+proj=igh +datum=WGS84 +units=m +no_defs",
        always_xy=True
    )
    x, y = transformer.transform(site["lon"], site["lat"])

    # Centro del pixel nativo: permite reutilizar descargas.
    x = -19949000 + (
        math.floor((x + 19949000) / 250) + 0.5
    ) * 250
    y = 8361000 - (
        math.floor((8361000 - y) / 250) + 0.5
    ) * 250

    for prop in properties:
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
        url = (
            "https://maps.isric.org/mapserv?"
            + urllib.parse.urlencode(query)
        )
        identifier = hashlib.sha256(
            url.encode()
        ).hexdigest()[:24]
        file = raw / f"{identifier}.tif"

        try:
            if file.exists():
                body = file.read_bytes()
            else:
                request = urllib.request.Request(
                    url,
                    headers={"User-Agent": "AndesPending/5.0"}
                )
                with urllib.request.urlopen(
                    request, timeout=45
                ) as response:
                    body = response.read()

            with MemoryFile(body) as memory:
                with memory.open() as dataset:
                    sample = next(
                        dataset.sample([(x, y)], masked=True)
                    )[0]
                    if (
                        getattr(sample, "mask", False)
                        or not math.isfinite(float(sample))
                    ):
                        raise ValueError("Pixel sin datos")
                    values[prop] = float(sample)

            if not file.exists():
                file.write_bytes(body)
                file.with_suffix(".json").write_text(
                    json.dumps({
                        "url": url,
                        "fecha_utc": dt.datetime.now(
                            dt.timezone.utc
                        ).isoformat()
                    }),
                    encoding="utf-8"
                )
            sources.append(url)

        except Exception as exc:
            errors.append({
                "sitio": site["sitio"],
                "anio": year,
                "fuente": "SoilGrids WCS " + prop,
                "error": str(exc)
            })

    source = " | ".join(sources)

    def add(parameter, value, note):
        emit(
            parameter, value, "modelo_SoilGrids",
            source, note
        )

    # Unidades originales:
    # bdod: cg/cm3; cfvo: cm3/dm3;
    # sand/clay: g/kg; soc: dg/kg.
    if "bdod" in values:
        density = values["bdod"] * 10
        if 0 < density < 2650:
            add(
                "rho_tierra_fina", density,
                "Densidad seca de tierra fina 0-5 cm; "
                "prediccion 250 m, no hielo."
            )

    if "cfvo" in values:
        coarse = values["cfvo"] / 1000
        if 0 <= coarse <= 1:
            add(
                "fragmentos_gruesos_suelo", coarse,
                "Fraccion >2 mm; NO detritos dentro del hielo."
            )

    for key, name, factor in [
        ("sand", "arena_suelo", 0.001),
        ("clay", "arcilla_suelo", 0.001),
        ("soc", "carbono_organico_suelo", 0.0001),
    ]:
        if key in values:
            add(
                name, values[key] * factor,
                "Fraccion masica en tierra fina, 0-5 cm. "
                "NO composicion del cuerpo de hielo."
            )

    if not all(
        prop in values for prop in ["bdod", "cfvo", "soc"]
    ):
        return

    density = values["bdod"] * 10
    coarse = values["cfvo"] / 1000
    carbon = values["soc"] / 10000

    # Criterio conservador del programa: evitar aplicar un modelo
    # mineral simple a suelos con carbono organico elevado.
    if not (
        0 < density < 2650
        and 0 <= coarse <= 1
        and carbon <= 0.05
    ):
        errors.append({
            "sitio": site["sitio"],
            "anio": year,
            "fuente": "Modelo termico",
            "error": (
                "Fuera del dominio mineral implementado o "
                "carbono organico >5%. No se estima k ni I."
            )
        })
        return

    bulk = (1 - coarse) * density + coarse * 2650
    porosity = 1 - bulk / 2650
    if porosity <= 0:
        return

    emit(
        "rho_cobertura", bulk,
        "estimacion_suelo_mineral", source,
        "Densidad seca estimada 0-5 cm; particulas "
        "2650 kg/m3 y fragmentos sin poros internos."
    )

    try:
        data, url = get(ERA, {
            "latitude": site["lat"],
            "longitude": site["lon"],
            "start_date": f"{year}-01-01",
            "end_date": f"{year}-12-31",
            "hourly": (
                "soil_temperature_0_to_7cm,"
                "soil_moisture_0_to_7cm"
            ),
            "models": "era5_land",
            "timezone": "UTC",
            "elevation": "nan"
        })

        units = data["hourly_units"]
        if (
            units["soil_temperature_0_to_7cm"] != "°C"
            or units["soil_moisture_0_to_7cm"] != "m³/m³"
        ):
            raise ValueError("Unidades ERA5-Land inesperadas")

        low, high, inertia_low, inertia_high = [], [], [], []
        dry_k = (
            (0.135 * bulk + 64.7)
            / (2700 - 0.947 * bulk)
        )

        temperatures = data["hourly"]["soil_temperature_0_to_7cm"]
        moistures = data["hourly"]["soil_moisture_0_to_7cm"]

        for temperature, moisture in zip(
            temperatures, moistures
        ):
            if not (
                isinstance(temperature, (int, float))
                and isinstance(moisture, (int, float))
            ):
                continue
            if not (
                math.isfinite(temperature)
                and math.isfinite(moisture)
                and 0 <= moisture <= porosity
            ):
                continue

            saturation = moisture / porosity
            frozen = temperature < 0
            coarse_texture = values.get("sand", 0) >= 500

            if frozen:
                kersten = saturation
            else:
                coefficient = 0.7 if coarse_texture else 1.0
                kersten = max(0, min(
                    1,
                    coefficient * math.log10(
                        max(saturation, 1e-12)
                    ) + 1
                ))

            pore_k = 2.3 if frozen else 0.57

            lower = dry_k + (
                2.0 ** (1 - porosity)
                * pore_k ** porosity - dry_k
            ) * kersten

            upper = dry_k + (
                7.7 ** (1 - porosity)
                * pore_k ** porosity - dry_k
            ) * kersten

            capacity = bulk * 800 + moisture * (
                917 * 2000 if frozen else 1000 * 4180
            )

            low.append(lower)
            high.append(upper)
            inertia_low.append(math.sqrt(lower * capacity))
            inertia_high.append(math.sqrt(upper * capacity))

        expected = (
            366 if calendar.isleap(year) else 365
        ) * 24

        note = (
            f"SoilGrids 0-5 cm + ERA5-Land 0-7 cm: "
            f"{len(low)}/{expected} horas compatibles. "
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

        if low and len(low) >= coverage * expected:
            emit(
                "k_cobertura", "",
                "estimacion_termica_condicionada",
                source + " | " + url + " | " + THERMAL,
                note,
                low=statistics.mean(low),
                high=statistics.mean(high),
                count=len(low), expected=expected
            )
            emit(
                "inercia_cobertura", "",
                "estimacion_termica_condicionada",
                source + " | " + url + " | " + THERMAL,
                note + " I=sqrt(k*Cvol), calculado hora a hora.",
                low=statistics.mean(inertia_low),
                high=statistics.mean(inertia_high),
                count=len(low), expected=expected
            )
        else:
            errors.append({
                "sitio": site["sitio"],
                "anio": year,
                "fuente": "Modelo termico",
                "error": note + " Cobertura insuficiente."
            })

    except Exception as exc:
        errors.append({
            "sitio": site["sitio"],
            "anio": year,
            "fuente": "ERA5-Land humedad/modelo termico",
            "error": str(exc)
        })


CAT.update(
    arena_suelo=("E2", "1", ""),
    arcilla_suelo=("E2", "1", ""),
    carbono_organico_suelo=("E2", "1", "")
)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sitios", help="CSV: sitio,lat,lon")
    parser.add_argument("--desde", type=int, default=2024)
    parser.add_argument("--hasta", type=int, default=2024)
    parser.add_argument(
        "--salida", default="resultados_unificados"
    )
    parser.add_argument(
        "--hipotesis",
        help="JSON con cambios respecto de las hipotesis iniciales"
    )
    parser.add_argument(
        "--locales",
        help=(
            "CSV: sitio,anio,parametro,valor,unidad,"
            "fuente,tipo,contexto"
        )
    )
    parser.add_argument("--sin-hipotesis", action="store_true")
    parser.add_argument("--cobertura", type=float, default=1.0)
    args = parser.parse_args()

    if not (
        1984 <= args.desde <= args.hasta < dt.date.today().year
        and 0 < args.cobertura <= 1
    ):
        parser.error(
            "Usar anos completos desde 1984 y cobertura en (0,1]."
        )

    hypotheses = DEFAULTS.copy()
    if args.hipotesis:
        changes = json.loads(
            Path(args.hipotesis).read_text(encoding="utf-8-sig")
        )
        unknown = set(changes) - set(hypotheses)
        if unknown:
            parser.error("Hipotesis desconocidas: " + str(unknown))
        hypotheses.update(changes)

    h = hypotheses
    if not all(
        isinstance(value, (int, float)) and math.isfinite(value)
        for value in h.values()
    ):
        parser.error("Las hipotesis deben ser numeros finitos.")

    if not (
        233.15 <= h["t_hielo_K"] <= 273.15
        and 0 <= h["detritos_v"] <= 1
        and 0 <= h["porosidad_gas"] < 1
        and 0 <= h["fraccion_sal_disuelta"] <= 1
        and 0 <= h["perclorato_wt_pct"] < 100
        and h["profundidad_m"] >= 0
        and h["sobrepresion_operacion_Pa"] >= 0
        and all(
            h[key] > 0
            for key in [
                "rho_hielo", "rho_detritos",
                "k_detritos", "agua_kg_por_kg_detrito",
            ]
        )
        and 0 < h["rho_cobertura_fallback"] < 2650
    ):
        parser.error("Hipotesis fuera de rango.")

    with open(
        args.sitios, encoding="utf-8-sig", newline=""
    ) as archivo:
        sites = list(csv.DictReader(archivo))

    names = set()
    for site in sites:
        site["lat"] = float(site["lat"])
        site["lon"] = float(site["lon"])
        if (
            not site["sitio"].strip()
            or site["sitio"] in names
            or not (
                -90 <= site["lat"] <= 90
                and -180 <= site["lon"] <= 180
            )
        ):
            parser.error(
                "Nombres duplicados/vacios o coordenadas invalidas."
            )
        names.add(site["sitio"])

    if not sites:
        parser.error("No hay sitios.")

    # Datos locales opcionales: se mantienen como información del sitio.
    local = {}
    if args.locales:
        with open(
            args.locales, encoding="utf-8-sig", newline=""
        ) as archivo:
            for row in csv.DictReader(archivo):
                if not row["valor"].strip():
                    continue

                parameter = row["parametro"]
                year = int(row["anio"])
                value = float(row["valor"])

                if (
                    parameter not in CAT
                    or row["unidad"] != CAT[parameter][1]
                    or row["sitio"] not in names
                    or not args.desde <= year <= args.hasta
                    or not math.isfinite(value)
                    or value < 0
                    or not row["fuente"].strip()
                    or not row["contexto"].strip()
                ):
                    parser.error("Dato local invalido: " + str(row))

                allow_zero = {
                    "detritos_v", "fragmentos_gruesos_suelo",
                    "perclorato", "z0", "viento_10m",
                    "solar", "sobrecarga",
                }
                if value == 0 and parameter not in allow_zero:
                    parser.error(
                        "Propiedad local debe ser positiva: "
                        + parameter
                    )
                if (
                    parameter in (
                        "detritos_v", "fragmentos_gruesos_suelo"
                    )
                    and value > 1
                ):
                    parser.error("Fracciones locales: usar 0-1.")
                if parameter.startswith("t_") and value <= 0:
                    parser.error("Temperaturas: kelvin >0.")
                if parameter == "perclorato" and value >= 100:
                    parser.error("Perclorato: wt%, menor que 100.")

                if row["tipo"] not in (
                    "media_anual", "puntual", "propiedad",
                    "estimacion", "diseno",
                ):
                    parser.error("Tipo local no reconocido.")

                atmospheric = {
                    "t_superficie", "p_superficie",
                    "viento_10m", "solar",
                    "rho_aire", "p_aire_10m",
                }
                if (
                    parameter in atmospheric
                    and row["tipo"] != "media_anual"
                ):
                    parser.error(
                        "Variables atmosfericas/superficie "
                        "requieren media_anual."
                    )

                key = (row["sitio"], year, parameter)
                if key in local:
                    parser.error("Dato local duplicado.")

                local[key] = (
                    value, row["tipo"],
                    row["fuente"], row["contexto"],
                )

    output = Path(args.salida)
    raw = output / "fuentes_originales"
    raw.mkdir(parents=True, exist_ok=True)

    (output / "hipotesis_usadas.json").write_text(
        json.dumps(h, indent=2), encoding="utf-8"
    )

    errors = []
    rows = []

    def get(base, query):
        url = base + "?" + urllib.parse.urlencode(query)
        identifier = hashlib.sha256(
            url.encode()
        ).hexdigest()[:24]
        file = raw / f"{identifier}.json"

        if file.exists():
            record = json.loads(
                file.read_text(encoding="utf-8")
            )
            return record["respuesta"], url

        for attempt in range(3):
            try:
                request = urllib.request.Request(
                    url,
                    headers={"User-Agent": "AndesAnalogos/4.0"},
                )
                with urllib.request.urlopen(
                    request, timeout=75
                ) as response:
                    data = json.load(response)

                record = {
                    "url": url,
                    "fecha_utc": dt.datetime.now(
                        dt.timezone.utc
                    ).isoformat(),
                    "respuesta": data,
                }
                file.write_text(
                    json.dumps(record, ensure_ascii=False),
                    encoding="utf-8",
                )
                return data, url

            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)

    for site in sites:
        for year in range(args.desde, args.hasta + 1):
            days = 366 if calendar.isleap(year) else 365
            real = {}

            def emit(
                parameter, value, state, source, note,
                scope="sitio", low="", high="",
                count="", expected=""
            ):
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

            # NASA POWER: superficie y atmósfera.
            try:
                data, url = get(POWER, {
                    "parameters": ",".join(NASA),
                    "community": "RE",
                    "latitude": site["lat"],
                    "longitude": site["lon"],
                    "start": f"{year}0101",
                    "end": f"{year}1231",
                    "format": "JSON",
                    "time-standard": "UTC",
                })
                series = {}

                for code, (
                    parameter, unit, factor, offset
                ) in NASA.items():
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
                    sufficient = (
                        bool(values)
                        and len(values) >= days * args.cobertura
                    )
                    emit(
                        parameter,
                        statistics.mean(values)
                        if sufficient else "",
                        state if sufficient
                        else "cobertura_insuficiente",
                        url, note,
                        count=len(values), expected=days,
                    )

                for code, (
                    parameter, _, _, _
                ) in NASA.items():
                    if parameter:
                        mean(
                            parameter,
                            list(series[code].values()),
                            "modelo_NASA",
                            code
                            + "; media diaria anual; celda regional, "
                            "no medicion local.",
                        )

                densities, pressures = [], []
                common = set.intersection(*(
                    set(series[code])
                    for code in ["T2M", "QV2M", "PS"]
                ))
                for day in common:
                    temperature = series["T2M"][day]
                    humidity = series["QV2M"][day]
                    pressure = series["PS"][day]
                    if (
                        temperature > 0
                        and pressure > 0
                        and 0 <= humidity < 1
                    ):
                        virtual_t = temperature * (
                            1 + 0.608 * humidity
                        )
                        densities.append(
                            pressure / (287.05 * virtual_t)
                        )
                        pressures.append(
                            pressure * math.exp(
                                -9.81 * 10
                                / (287.05 * virtual_t)
                            )
                        )

                mean(
                    "rho_aire", densities,
                    "estimacion_atmosferica",
                    "P/(Rd*Tv), Tv=T*(1+0.608q); "
                    "T y q a 2 m; medias diarias.",
                )
                mean(
                    "p_aire_10m", pressures,
                    "estimacion_hidrostatica",
                    "Ps*exp(-g*10/(Rd*Tv)); "
                    "capa isoterma; NO cavidad.",
                )

            except Exception as exc:
                errors.append({
                    "sitio": site["sitio"], "anio": year,
                    "fuente": "NASA", "error": str(exc),
                })

            # ERA5-Land: temperatura de capas del suelo.
            try:
                variables = [
                    "soil_temperature_" + layer
                    for layer in LAYERS
                ]
                data, url = get(ERA, {
                    "latitude": site["lat"],
                    "longitude": site["lon"],
                    "start_date": f"{year}-01-01",
                    "end_date": f"{year}-12-31",
                    "hourly": ",".join(variables),
                    "models": "era5_land",
                    "timezone": "UTC",
                    "elevation": "nan",
                })

                for code, layer in zip(variables, LAYERS):
                    if data["hourly_units"][code] != "°C":
                        raise ValueError("Unidad ERA5 inesperada")

                    values = [
                        value + 273.15
                        for value in data["hourly"][code]
                        if (
                            isinstance(value, (int, float))
                            and math.isfinite(value)
                        )
                    ]
                    sufficient = (
                        bool(values)
                        and len(values)
                        >= days * 24 * args.cobertura
                    )
                    emit(
                        "t_suelo_" + layer,
                        statistics.mean(values)
                        if sufficient else "",
                        "modelo_ERA5_Land" if sufficient
                        else "cobertura_insuficiente",
                        url,
                        f"Capa {layer}; NO prueba hielo. "
                        f"Celda {data['latitude']},"
                        f"{data['longitude']}; "
                        "sin ajuste altitudinal.",
                        count=len(values), expected=days * 24,
                    )

            except Exception as exc:
                errors.append({
                    "sitio": site["sitio"], "anio": year,
                    "fuente": "ERA5-Land/Open-Meteo",
                    "error": str(exc),
                })

            # SoilGrids: propiedades del suelo mineral.
            suelo_pendiente(site, year, emit, get, raw, errors, args.cobertura)

            # Los datos locales reemplazan al modelo correspondiente.
            for (
                name, local_year, parameter
            ), (
                value, kind, source, note
            ) in local.items():
                if name == site["sitio"] and local_year == year:
                    rows[:] = [
                        row for row in rows
                        if not (
                            row["sitio"] == name
                            and row["anio"] == year
                            and row["parametro"] == parameter
                            and row["ambito"] == "sitio"
                        )
                    ]
                    emit(
                        parameter, value,
                        "local_" + kind, source, note,
                    )

            for parameter in CAT:
                if parameter not in real:
                    emit(
                        parameter, "", "pendiente", "",
                        "Sin informacion local suficiente.",
                    )

            # Escenarios: nunca reemplazan las filas del sitio.
            if not args.sin_hipotesis:
                def observed(parameter, default):
                    value = real.get(
                        parameter, {}
                    ).get("valor", "")
                    return (
                        value if isinstance(value, (int, float))
                        else default
                    )

                def scenario(
                    parameter, value, note,
                    low="", high="",
                    source="hipotesis_usadas.json"
                ):
                    emit(
                        parameter, value,
                        "HIPOTESIS_NO_MEDICION_LOCAL",
                        source, note, "escenario", low, high,
                    )

                temperature = observed(
                    "t_hielo", h["t_hielo_K"]
                )
                debris = observed(
                    "detritos_v", h["detritos_v"]
                )
                porosity = h["porosidad_gas"]

                scenario(
                    "t_hielo", temperature,
                    "Dato local si existe; de lo contrario "
                    "temperatura impuesta de ensayo, "
                    "NO inferida del clima.",
                )
                scenario(
                    "detritos_v", debris,
                    "Dato local si existe; de lo contrario "
                    "mezcla supuesta para ensayo. "
                    "Volumen sin poros gaseosos.",
                )

                density = observed(
                    "rho_cuerpo",
                    (1 - porosity) * (
                        (1 - debris) * h["rho_hielo"]
                        + debris * h["rho_detritos"]
                    ),
                )
                scenario(
                    "rho_cuerpo", density,
                    "Dato local si existe; si no "
                    "(1-phi)*[(1-fd)*rho_hielo+fd*rho_detritos]. "
                    "Poros con gas, sin liquido.",
                )

                if 233.15 <= temperature <= 273.15:
                    ice_k = 567 / temperature
                    debris_k = h["k_detritos"]
                    minimum_k = 1 / (
                        (1 - porosity) * (
                            (1 - debris) / ice_k
                            + debris / debris_k
                        )
                        + porosity / 0.024
                    )
                    maximum_k = (
                        (1 - porosity) * (
                            (1 - debris) * ice_k
                            + debris * debris_k
                        )
                        + porosity * 0.024
                    )
                    scenario(
                        "k_cuerpo", "",
                        "567/T para hielo; limites serie/paralelo "
                        "de mezcla; k_gas=0.024. "
                        "No se conoce su geometria.",
                        minimum_k, maximum_k,
                    )
                else:
                    scenario(
                        "k_cuerpo", "",
                        "Temperatura local fuera del rango "
                        "implementado; requiere otra parametrizacion.",
                    )

                bulk = observed(
                    "rho_cobertura",
                    h["rho_cobertura_fallback"],
                )
                if 0 < bulk < 2650:
                    soil_porosity = 1 - bulk / 2650
                    minimum_k = (
                        (0.135 * bulk + 64.7)
                        / (2700 - 0.947 * bulk)
                    )
                    maximum_k = (
                        7.7 ** (1 - soil_porosity)
                        * 2.3 ** soil_porosity
                    )
                    note = (
                        "Escenario de suelo mineral: seco a "
                        "saturado congelado; k_mineral hasta 7.7, "
                        "k_hielo=2.3. NO intervalo estadistico "
                        "ni promedio anual."
                    )
                    scenario(
                        "k_cobertura", "", note,
                        minimum_k, maximum_k, THERMAL,
                    )
                    scenario(
                        "inercia_cobertura", "",
                        note
                        + " I=sqrt(k*Cvol); cp_mineral supuesto "
                        "700-1000; aporte agua hasta por*4.18e6.",
                        math.sqrt(minimum_k * bulk * 700),
                        math.sqrt(
                            maximum_k * (
                                bulk * 1000
                                + soil_porosity * 4.18e6
                            )
                        ),
                        THERMAL,
                    )
                else:
                    scenario(
                        "k_cobertura", "",
                        "Densidad local incompatible con el "
                        "escenario mineral; requiere modelo especifico.",
                    )
                    scenario(
                        "inercia_cobertura", "",
                        "Faltan propiedades compatibles de la cobertura.",
                    )

                scenario(
                    "sobrecarga",
                    density * 9.81 * h["profundidad_m"],
                    "rho*g*h; columna uniforme terrestre. "
                    "No incluye otra cobertura ni atmosfera.",
                )

                ambient = observed("p_superficie", None)
                pressure = (
                    None if ambient is None
                    else ambient + h["sobrepresion_operacion_Pa"]
                )
                scenario(
                    "p_operacion",
                    pressure if pressure is not None else "",
                    "Patm + sobrepresion impuesta; "
                    "NO calculo de diseno, ni presion "
                    "admisible de cavidad.",
                )

                perchlorate = observed(
                    "perclorato", h["perclorato_wt_pct"]
                )
                scenario(
                    "perclorato", perchlorate,
                    "Dato local si existe; si no supuesto "
                    "inspirado en Phoenix, SIN evidencia de "
                    "presencia en Argentina. "
                    "wt% de anion ClO4 en detrito seco.",
                )

                # Mg(ClO4)2: dos aniones por mol de sal.
                # Aproximación ideal diluida: i = 3.
                osmoles = (
                    3 * (perchlorate / 100)
                    * h["fraccion_sal_disuelta"]
                    / (
                        2 * 0.09945
                        * h["agua_kg_por_kg_detrito"]
                    )
                )

                if (
                    osmoles <= 0.1
                    and pressure is not None
                    and 611 < pressure <= 5e6
                ):
                    freezing = (
                        273.15
                        - 1.86 * osmoles
                        - 7.4e-8 * (pressure - 101325)
                    )
                    scenario(
                        "t_congelacion", freezing,
                        "Sal supuesta Mg(ClO4)2; disolucion "
                        "segun balance de anion y agua. "
                        "Tf=273.15-1.86*osmoles"
                        "-7.4e-8*(P-101325). "
                        "Ideal diluido; no eutectico. "
                        "Correccion de presion lineal "
                        "aproximada del hielo I.",
                        source=FREEZE,
                    )
                else:
                    scenario(
                        "t_congelacion", "",
                        "Fuera del dominio ideal diluido "
                        "o sin presion: requiere diagrama "
                        "de fases; NO se extrapola a 206 K.",
                    )

            print("Procesado:", site["sitio"], year)

    fields = [
        "sitio", "lat", "lon", "anio", "etapa",
        "parametro", "valor", "unidad", "estado", "ambito",
        "minimo", "maximo", "muestras_validas",
        "muestras_esperadas", "fuente",
        "justificacion", "referencia_marte",
    ]
    with (output / "comparacion.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as archivo:
        writer = csv.DictWriter(archivo, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    report = {
        "errores": errors,
        "argumentos": vars(args),
        "hipotesis_activas": not args.sin_hipotesis,
        "hipotesis": h,
        "locales": [
            {
                "sitio": key[0], "anio": key[1],
                "parametro": key[2], "datos": value,
            }
            for key, value in local.items()
        ],
        "aviso": (
            "Referencias marcianas aportadas, no verificadas. "
            "Escenarios NO demuestran hielo o sales locales. "
            "Propiedades materiales NO son promedios anuales."
        ),
        "fecha_utc": dt.datetime.now(
            dt.timezone.utc
        ).isoformat(),
    }
    (output / "informe.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(
        "Salida:", output / "comparacion.csv",
        "; fuentes fallidas:", len(errors),
    )
    if errors:
        print(
            "Revisar informe.json: se conservaron "
            "las otras fuentes y escenarios."
        )


if __name__ == "__main__":
    main()