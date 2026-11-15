# Mars ↔ Andes Glacier Analogs

**NASA Space Apps Challenge 2026 · Team Rotemos_B(its)**

An interactive 3D journey from the glacier-like forms of Mars to their closest analogs among the
glaciers of the Argentine Andes.

1. A SHARAD radar sweep reveals the 1,309 Martian glacier-like forms of the Souness et al. (2012) inventory.
2. Pick one. Its local surface conditions are computed: pressure from its MOLA elevation, and
   temperature and irradiance from its latitude.
3. All 7,719 glaciers of the Argentine National Glacier Inventory (ING · IANIGLA) are scored against
   those conditions with the team's coincidence pipeline.
4. After you confirm the flight plan, the camera flies to Earth and lands on the best analog.
5. On Earth, the inventory and a uniform survey grid of the Andes are shown, the sectors are ranked
   with their best ices, and any glacier can be compared parameter by parameter.

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The method, data pipeline, architecture and credits are documented in [frontend/README.md](frontend/README.md).
