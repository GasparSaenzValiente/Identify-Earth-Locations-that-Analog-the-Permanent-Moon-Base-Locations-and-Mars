# Andes–Mars comparison pipeline

Scripts for retrieving environmental data and comparing terrestrial
sites against the reference parameters in `parametros_marte.json`.

## Setup

Run from the repository root:

```bash
cd scripts
python -m venv .venv
# Activate the environment using the command for your operating system.
python -m pip install -r requirements.txt
```

## Example runs

Process the single example site:

```bash
python analogos_rapido.py sitios.csv --desde 2024 --hasta 2024
```

Evaluate a small subset of the Andes grid:

```bash
python evaluador_marte_v2.py puntos_uniformes_andes.csv --limite 5
```

Evaluate the glacier inventory:

```bash
python evaluador_marte_v2.py glaciares_GEA_GEI.csv
```

## Inputs

- `sitios.csv`: one example site in Mendoza.
- `puntos_uniformes_andes.csv`: uniform sampling grid over the Andes.
- `glaciares_GEA_GEI.csv`: 7,719 glacier coordinate records.
- `parametros_marte.json`: Martian reference values and citations.

## Outputs and resuming

The evaluator writes `resultados_coincidencia.json` and stores downloaded
sources and progress in `trabajo_evaluador/`.

Run the same command again to resume an interrupted evaluation.
External services have request limits; large runs may require multiple sessions.

## Interpretation

The default score is relative to the set of evaluated sites.
It is not a probability or an absolute percentage of physical equivalence.
Changing the evaluated set can change the scores.

Some parameters are estimates or model assumptions. See the reference
JSON and source documentation for their scope and limitations.