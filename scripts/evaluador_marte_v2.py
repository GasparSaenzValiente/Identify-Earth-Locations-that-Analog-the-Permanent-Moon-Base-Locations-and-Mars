#!/usr/bin/env python3
"""Evaluador de coincidencia Tierra-Marte (versión rápida de evaluador_marte_v1).

Mismo puntaje que v1, pero sin lanzar un proceso por punto:
  1) descarga en paralelo (por servidor) todo lo que falte, con caché
     compartida en --trabajo/fuentes_originales;
  2) calcula todos los puntos en varios procesos (12 hilos del i5-10400F);
  3) guarda el avance en --trabajo/progreso.jsonl: si se corta (o se agota
     la cuota diaria de Open-Meteo), volver a correr el mismo comando sigue
     desde donde quedó y no repite descargas.

Uso típico:
    python evaluador_marte_v2.py                       # todo
    python evaluador_marte_v2.py --verificar-agrupado 5  # chequeo previo
    python evaluador_marte_v2.py --limite 50           # prueba corta
"""

import argparse
import csv
import json
import math
import os
from pathlib import Path
import random
import re
import time

import analogos_rapido as ar
from evaluador_marte_v1 import PESOS_ETAPAS
from evaluador_marte_v1 import cargar_valores_marte as cargar_valores_marte_v1

NUMERO = re.compile(r"[-+]?\d+(?:\.\d+)?")


def leer_numero(texto, unidad):
    """Primer número de un texto en notación española.

    * '.' seguido de exactamente 3 dígitos es separador de miles
      ('1.220 kg/m³' -> 1220), ',' es la coma decimal ('0,021' -> 0.021);
    * '−' (signo menos unicode) se toma como '-';
    * si la unidad del parámetro es adimensional ('1') y el número va
      seguido de '%' (no 'wt%'), se pasa a fracción ('< 20%' -> 0.20).
    """
    t = texto.replace("\u2212", "-")
    t = re.sub(r"(?<=\d)\.(?=\d{3}(?!\d))", "", t)
    t = t.replace(",", ".")
    m = NUMERO.search(t)
    if not m:
        return None
    valor = float(m.group())
    resto = t[m.end():].lstrip()
    if unidad == "1" and resto.startswith("%"):
        valor /= 100
    return valor


def cargar_valores_marte(json_path):
    """Valores marcianos por parámetro (clave '--> nombre' del JSON)."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    valores = {}
    for fase in data.get("fases", []):
        for param in fase.get("parametros", []):
            comentario = param.get("_comentario", "")
            if not comentario.startswith("--> "):
                continue
            key = comentario[4:].strip()
            unidad = ar.CAT.get(key, ("", "", ""))[1]
            v = leer_numero(param["valor"], unidad)
            if v is not None:
                valores[key] = v
    if "sobrecarga" not in valores:
        valores["sobrecarga"] = 44520.0
    return valores


def puntuar(rows, valores_marte, incluir_escenarios=False):
    """Puntaje ponderado por etapa (misma fórmula que v1).

    Por defecto sólo usa filas del sitio (ambito == 'sitio'): las filas de
    'escenario' son hipótesis de ensayo, iguales en todos los puntos, y no
    deben influir en la coincidencia.
    """
    suma_ponderada = 0
    suma_pesos = 0
    detalles = []
    for res in rows:
        param = res["parametro"]
        val = res["valor"]
        etapa = res["etapa"]
        if val == "" or val is None:   # en v1: celda vacía del CSV
            continue
        if not incluir_escenarios and res.get("ambito", "sitio") != "sitio":
            continue
        try:
            val_tierra = float(val)
        except ValueError:
            continue
        val_marte = valores_marte.get(param)
        if val_marte is None or val_marte == 0:
            continue
        delta = abs(val_tierra - val_marte)
        error_relativo = delta / abs(val_marte)
        coincidencia_param = max(0.0, 1.0 - error_relativo)
        peso = PESOS_ETAPAS.get(etapa, 1)
        suma_ponderada += coincidencia_param * peso
        suma_pesos += peso
        detalles.append({
            "parametro": param,
            "valor_tierra": val_tierra,
            "valor_marte": val_marte,
            "delta": delta,
            "peso_etapa": peso,
            "etapa": etapa,
            "ambito": res.get("ambito", "sitio"),
        })
    porcentaje = (suma_ponderada / suma_pesos * 100) if suma_pesos > 0 else 0.0
    return porcentaje, detalles


def puntuar_relativo(registros, valores_marte, faltantes="comunes",
                     cuantiles=(5, 95)):
    """Puntaje relativo entre los puntos evaluados.

    Para cada parámetro p con valor marciano m:
      d = |ln(valor_tierra / m)|            (distancia en escala logarítmica:
                                             x2 o /2 cuentan igual)
      s = 1 - (d - d_q5) / (d_q95 - d_q5)   recortado a [0, 1]
    donde d_q5 y d_q95 son los cuantiles 5 y 95 de d entre TODOS los puntos.
    s = 1: entre los más parecidos a Marte; s = 0: entre los más lejanos.
    Porcentaje = media de s ponderada por etapa (PESOS_ETAPAS) x 100.

    faltantes = "comunes":   sólo parámetros que tienen todos los puntos.
    faltantes = "penalizar": todos los parámetros; si un punto no tiene uno,
                             cuenta con s = 0 (mismo trato para todos).
    Valores <= 0 (p. ej. z0 = 0) se reemplazan por la mitad del menor valor
    positivo observado de ese parámetro.
    """
    import collections
    import math
    import numpy as np

    por_punto = []
    for r in registros:
        d = {}
        for p, v, e, a in r["filas"]:
            if a != "sitio" or p not in valores_marte or valores_marte[p] <= 0:
                continue
            try:
                v = float(v)
            except (TypeError, ValueError):
                continue
            if math.isfinite(v):
                d[p] = (v, e)
        por_punto.append(d)

    n = len(registros)
    presentes = collections.Counter(p for d in por_punto for p in d)
    if faltantes == "comunes":
        params = [p for p in valores_marte if presentes.get(p) == n]
    else:
        params = [p for p in valores_marte if presentes.get(p)]

    escala = {}
    for p in params:
        m = valores_marte[p]
        vals = np.array([d[p][0] for d in por_punto if p in d])
        pos = vals[vals > 0]
        eps = pos.min() / 2 if pos.size else 1e-12
        dist = np.abs(np.log(np.maximum(vals, eps) / m))
        lo, hi = np.percentile(dist, cuantiles)
        escala[p] = (float(eps), float(lo), float(hi))

    salida = []
    for d in por_punto:
        suma = pesos = 0.0
        detalles = []
        for p in params:
            eps, lo, hi = escala[p]
            m = valores_marte[p]
            if p in d:
                v, etapa = d[p]
                dist = abs(math.log(max(v, eps) / m))
                sim = 1.0 if hi <= lo else min(1.0, max(0.0, 1 - (dist - lo) / (hi - lo)))
            else:
                v, etapa, dist, sim = None, ar.CAT[p][0], None, 0.0
            peso = PESOS_ETAPAS.get(etapa, 1)
            suma += sim * peso
            pesos += peso
            detalles.append({
                "parametro": p,
                "valor_tierra": v,
                "valor_marte": m,
                "distancia_log": dist,
                "similitud": sim,
                "peso_etapa": peso,
                "etapa": etapa,
            })
        salida.append((suma / pesos * 100 if pesos else 0.0, detalles))
    return salida, params, escala


def leer_puntos(path):
    puntos = []
    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            lat = float(row["lat"])
            lon = float(row["lon"])
            puntos.append({
                # nombre que v1 le daba al sitio dentro de analogos
                "sitio": f"Punto_{lat}_{lon}",
                "lat": lat,
                "lon": lon,
                "_nombre": row.get("sitio", f"{lat}_{lon}"),
                "_id": row.get("id"),
            })
    return puntos


def clave(p):
    return f"{p['_nombre']}|{p['lat']!r}|{p['lon']!r}"


def verificar_agrupado(puntos, n, anio, raw, h):
    """Compara, para n puntos al azar, la consulta exacta contra la agrupada."""
    exacto = ar.Contexto(raw, h, agrupar=False, sitios=puntos)
    agrup = ar.Contexto(raw, h, agrupar=True, sitios=puntos)
    malos = 0
    for p in random.Random(0).sample(puntos, min(n, len(puntos))):
        for nombre, base, qa, qb, extraer in [
            ("ERA5", ar.ERA, exacto.q_era(p, anio), agrup.q_era(p, anio),
             lambda d: (d["latitude"], d["longitude"], d["hourly"])),
            ("POWER", ar.POWER, exacto.q_power(p, anio),
             agrup.q_power(p, anio),
             lambda d: d["properties"]["parameter"]),
        ]:
            if qa == qb:
                print(f"  {nombre:5s} {p['lat']:.4f},{p['lon']:.4f}: "
                      "es el representante (misma consulta)")
                continue
            da, _ = exacto.cache.json(base, qa)
            db, _ = agrup.cache.json(base, qb)
            igual = extraer(da) == extraer(db)
            malos += not igual
            print(f"  {nombre:5s} {p['lat']:.4f},{p['lon']:.4f}: "
                  + ("IDÉNTICO" if igual else "DIFERENTE <--"))
    if malos:
        print(f"\n{malos} diferencias: usar --exacto para no agrupar.")
    else:
        print("\nAgrupado por celda verificado: mismos datos.")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("puntos", nargs="?", default="puntos_uniformes_andes.csv")
    ap.add_argument("--marte", default="parametros_marte.json")
    ap.add_argument("--salida", default="resultados_coincidencia.json")
    ap.add_argument("--trabajo", default="trabajo_evaluador",
                    help="carpeta de caché y avance (reutilizable)")
    ap.add_argument("--anio", type=int, default=2024)
    ap.add_argument("--limite", type=int,
                    help="evaluar sólo los primeros N puntos (prueba)")
    ap.add_argument("--solo-descargar", action="store_true")
    ap.add_argument("--guardar-csv", action="store_true",
                    help="guardar también todas las filas en "
                         "<trabajo>/comparacion_todos.csv (archivo grande)")
    ap.add_argument("--verificar-agrupado", type=int, metavar="N",
                    help="comparar N puntos exacto vs agrupado y salir")
    ap.add_argument("--sin-era5", action="store_true",
                    help="no usar ERA5-Land (Open-Meteo). No cambia el puntaje "
                         "actual: ERA5 sólo aporta t_suelo y rangos de k/I")
    ap.add_argument("--puntaje", choices=["relativo", "absoluto", "v1"],
                    default="relativo",
                    help="relativo (def.): distancia logarítmica normalizada "
                         "entre los puntos; absoluto: 1-|T-M|/|M| (v1 "
                         "corregido); v1: puntaje original con sus errores")
    ap.add_argument("--faltantes", choices=["comunes", "penalizar"],
                    default="comunes",
                    help="(relativo) comunes: sólo parámetros que tienen todos "
                         "los puntos; penalizar: faltante cuenta como 0")
    ap.add_argument("--puntaje-v1", action="store_true",
                    help="equivale a --puntaje v1")
    ap.add_argument("--solo-puntaje", action="store_true",
                    help="no descargar ni calcular: sólo recalcular el puntaje "
                         "con lo ya guardado en <trabajo>/progreso.jsonl")
    ar.agregar_args_rendimiento(ap)
    args = ap.parse_args()
    ar.aplicar_args_rendimiento(args)
    if args.puntaje_v1:
        args.puntaje = "v1"
    args.puntaje_v1 = args.puntaje == "v1"

    t0 = time.time()
    trabajo = Path(args.trabajo)
    raw = trabajo / "fuentes_originales"
    raw.mkdir(parents=True, exist_ok=True)
    progreso = trabajo / "progreso.jsonl"

    if args.puntaje_v1:
        valores_marte = cargar_valores_marte_v1(args.marte)
    else:
        valores_marte = cargar_valores_marte(args.marte)
    print("Valores de Marte usados:", json.dumps(valores_marte), flush=True)
    h = ar.DEFAULTS.copy()
    puntos = leer_puntos(args.puntos)
    if args.limite:
        puntos = puntos[:args.limite]

    if args.verificar_agrupado:
        verificar_agrupado(puntos, args.verificar_agrupado, args.anio, raw, h)
        return

    hechos = {}
    if progreso.exists():
        with progreso.open(encoding="utf-8") as f:
            for linea in f:
                if linea.strip():
                    r = json.loads(linea)
                    if "filas" not in r:   # versión previa: rehacer
                        continue
                    if (r.get("sin_era5") and not args.sin_era5
                            and not args.solo_puntaje):
                        continue           # completar ahora con ERA5
                    hechos[r["_clave"]] = r
    pendientes = [i for i, p in enumerate(puntos) if clave(p) not in hechos]
    print(f"Puntos: {len(puntos)}  ya evaluados: {len(puntos) - len(pendientes)}"
          f"  pendientes: {len(pendientes)}", flush=True)

    diferidos = 0
    if args.solo_puntaje:
        armar_resultados(puntos, hechos, valores_marte, args, t0, diferidos)
        return

    kwargs = dict(raw=raw, h=h, agrupar=not args.exacto, sitios=puntos,
                  sin_era5=args.sin_era5)
    sub = [puntos[i] for i in pendientes]

    # 1) Descargas ----------------------------------------------------------
    if sub:
        print("\n[1/2] Descargas", flush=True)
        resumen = ar.descargar_todo(sub, [args.anio], ar.Contexto(**kwargs))
        print("Resumen descargas:", json.dumps(resumen), flush=True)
    if args.solo_descargar:
        return

    # 2) Cálculo en paralelo -----------------------------------------------
    print(f"\n[2/2] Cálculo con {args.procesos} procesos", flush=True)
    orden = sorted(pendientes, key=lambda i: (  # noqa
        ar.clave_era(puntos[i]["lat"], puntos[i]["lon"]),
        ar.clave_power(puntos[i]["lat"], puntos[i]["lon"])))
    csv_f = writer = None
    if args.guardar_csv:
        ruta_csv = trabajo / "comparacion_todos.csv"
        nuevo = not ruta_csv.exists()
        csv_f = ruta_csv.open("a", encoding="utf-8-sig", newline="")
        writer = csv.DictWriter(csv_f, fieldnames=ar.FIELDS)
        if nuevo:
            writer.writeheader()

    t1 = time.time()
    with progreso.open("a", encoding="utf-8") as out:
        for n, (i, _, rows, errs) in enumerate(ar.calcular_todo(
                puntos, [args.anio], kwargs, args.procesos, orden), 1):
            p = puntos[i]
            if any(e.get("transitorio") for e in errs):
                diferidos += 1      # se reintenta en la próxima corrida
            else:
                r = {
                    "_clave": clave(p),
                    "sitio": p["_nombre"],
                    "lat": p["lat"],
                    "lon": p["lon"],
                    "sin_era5": args.sin_era5,
                    # datos mínimos para recalcular el puntaje sin re-correr
                    "filas": [
                        [x["parametro"], x["valor"], x["etapa"], x["ambito"]]
                        for x in rows if x["valor"] != ""
                    ],
                }
                if p["_id"] is not None:
                    r["id"] = p["_id"]
                if errs:
                    r["errores_fuente"] = errs
                hechos[r["_clave"]] = r
                out.write(json.dumps(r, ensure_ascii=False) + "\n")
                if writer:
                    writer.writerows(rows)
            if n % 500 == 0 or n == len(orden):
                out.flush()
                v = n / max(time.time() - t1, 1e-9)
                print(f"  calculados {n}/{len(orden)}  ({v:.0f} puntos/s)",
                      flush=True)
    if csv_f:
        csv_f.close()

    armar_resultados(puntos, hechos, valores_marte, args, t0, diferidos)


def armar_resultados(puntos, hechos, valores_marte, args, t0, diferidos):
    """JSON final en el orden del CSV. El puntaje se recalcula siempre
    desde las filas guardadas, así que cambiar el criterio no exige re-correr."""
    registros = [hechos[clave(p)] for p in puntos if clave(p) in hechos]
    filas_de = [[dict(parametro=a, valor=b, etapa=c, ambito=d)
                 for a, b, c, d in r["filas"]] for r in registros]

    absolutos = [puntuar(f, valores_marte,
                         incluir_escenarios=args.puntaje == "v1")
                 for f in filas_de]
    if args.puntaje == "relativo":
        relativos, params, escala = puntuar_relativo(
            registros, valores_marte, args.faltantes)
        print(f"\nPuntaje relativo ({args.faltantes}); parámetros usados:")
        for p in params:
            eps, lo, hi = escala[p]
            print(f"  {p:15s} Marte={valores_marte[p]:<8g} s=1 si Tierra/Marte "
                  f"dentro de x{math.exp(lo):.3g}, s=0 desde x{math.exp(hi):.3g}")
        sin_usar = [p for p in valores_marte if p not in params]
        print("  sin usar (no hay dato del sitio" +
              (" en todos los puntos" if args.faltantes == "comunes" else "") +
              "):", ", ".join(sin_usar))

    finales = []
    for k, r in enumerate(registros):
        if args.puntaje == "relativo":
            porcentaje, detalles = relativos[k]
        else:
            porcentaje, detalles = absolutos[k]
            if args.puntaje == "v1":
                for d in detalles:
                    d.pop("ambito", None)
        salida = {"sitio": r["sitio"], "lat": r["lat"], "lon": r["lon"],
                  "porcentaje_coincidencia": porcentaje,
                  "detalles": detalles}
        if args.puntaje == "relativo":
            salida["criterio"] = f"relativo_{args.faltantes}"
            salida["porcentaje_absoluto"] = absolutos[k][0]
        for key in ("id", "errores_fuente"):
            if key in r:
                salida[key] = r[key]
        finales.append(salida)
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(finales, f, indent=4, ensure_ascii=False)

    print(f"\nGuardado {args.salida}: {len(finales)}/{len(puntos)} puntos "
          f"en {time.time() - t0:.0f} s.")
    if diferidos:
        print(f"{diferidos} puntos con fuentes no disponibles (red / cuota). "
              "Volver a correr el mismo comando para completarlos.")


if __name__ == "__main__":
    main()
