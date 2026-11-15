import sys
import json
import csv
import tempfile
import subprocess
import os
import re

# Asignación de valores del 1 al 5 para las etapas (E1 a E4)
PESOS_ETAPAS = {
    "E1": 2,
    "E2": 3,
    "E3": 4,
    "E4": 5
}

def cargar_valores_marte(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    valores_marte = {}
    for fase in data.get('fases', []):
        for param in fase.get('parametros', []):
            # Obtener el nombre de la variable usando la marca en los comentarios del JSON
            comentario = param.get('_comentario', '')
            if comentario.startswith('--> '):
                key = comentario.replace('--> ', '').strip()
            else:
                key = param['parametro']
                
            val_str = param['valor']
            # Extraer el primer valor numérico (incluyendo decimales y negativos)
            match = re.search(r"[-+]?\d*\.\d+|\d+", val_str.replace(',', '.'))
            if match:
                valores_marte[key] = float(match.group())
                
    # Valor de sobrecarga por defecto si no está explícito numéricamente en el JSON
    if "sobrecarga" not in valores_marte:
        valores_marte["sobrecarga"] = 44520.0
        
    return valores_marte

def funcion_uno_evaluar_punto(lat, lon, script_path="analogos_actualizado.py", json_marte_path="parametros_marte.json"):
    """
    Llama al script de análogos, obtiene los parámetros para una lat y lon,
    lee los valores de Marte, calcula deltas y devuelve un porcentaje de coincidencia.
    """
    valores_marte = cargar_valores_marte(json_marte_path)
    
    # Crear CSV temporal de entrada simulando un sitio para ejecutar analogos_actualizado.py
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.csv') as tmp_in:
        writer = csv.writer(tmp_in)
        writer.writerow(["sitio", "lat", "lon"])
        writer.writerow([f"Punto_{lat}_{lon}", lat, lon])
        tmp_in_name = tmp_in.name

    out_dir = tempfile.mkdtemp()
    
    # Llamar al script via subprocess
    cmd = [sys.executable, script_path, tmp_in_name, "--salida", out_dir]
    subprocess.run(cmd, capture_output=True)
    
    out_csv = os.path.join(out_dir, "comparacion.csv")
    resultados = []
    if os.path.exists(out_csv):
        with open(out_csv, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                resultados.append(row)
                
    suma_ponderada = 0
    suma_pesos = 0
    detalles = []
    
    for res in resultados:
        param = res["parametro"]
        val_str = res["valor"]
        etapa = res["etapa"]
        
        # Filtrar valores nulos o que no pudieron ser modelados
        if not val_str:
            continue
            
        try:
            val_tierra = float(val_str)
        except ValueError:
            continue
            
        val_marte = valores_marte.get(param)
        if val_marte is None or val_marte == 0:
            continue
            
        # 1. Delta: valor absoluto de la resta
        delta = abs(val_tierra - val_marte)
        
        # 2. Convertir delta en un porcentaje de coincidencia (0 a 1) por parametro
        error_relativo = delta / abs(val_marte)
        coincidencia_param = max(0.0, 1.0 - error_relativo)
        
        # 3. Suma ponderada con pesos 1 al 5
        peso = PESOS_ETAPAS.get(etapa, 1)
        
        suma_ponderada += coincidencia_param * peso
        suma_pesos += peso
        
        detalles.append({
            "parametro": param,
            "valor_tierra": val_tierra,
            "valor_marte": val_marte,
            "delta": delta,
            "peso_etapa": peso,
            "etapa": etapa
        })
        
    # Calcular el porcentaje de coincidencia final (escala 0-100%)
    porcentaje_final = (suma_ponderada / suma_pesos * 100) if suma_pesos > 0 else 0.0
    
    # Limpiar archivos temporales
    os.remove(tmp_in_name)
    
    return porcentaje_final, detalles


def funcion_dos_procesar_puntos(csv_puntos_path="puntos_uniformes_andes.csv", out_json="resultados_coincidencia.json"):
    """
    Itera sobre el archivo CSV de puntos en los Andes, llama a la funcion uno,
    y guarda los porcentajes y valores ponderados obtenidos en un archivo JSON.
    """
    resultados_totales = []
    
    with open(csv_puntos_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            lat = float(row["lat"])
            lon = float(row["lon"])
            sitio = row.get("sitio", f"{lat}_{lon}")
            
            print(f"Evaluando coincidencia para {sitio}...")
            
            porcentaje, detalles = funcion_uno_evaluar_punto(lat, lon)
            
            resultados_totales.append({
                "sitio": sitio,
                "lat": lat,
                "lon": lon,
                "porcentaje_coincidencia": porcentaje,
                "detalles": detalles
            })
            
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(resultados_totales, f, indent=4, ensure_ascii=False)
        
    return out_json

if __name__ == '__main__':
    # Ejemplo de ejecución
    funcion_dos_procesar_puntos('puntos_uniformes_andes.csv')