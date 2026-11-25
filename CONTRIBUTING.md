# Contributing

Thank you for your interest in improving CustomerIQ.

## Development setup

Follow [Installation and How to run in the README](README.md#installation). The main interface is the React web app served by `python -m src.api`. The Streamlit app (`python -m streamlit run app.py --server.port 8517`) is a fallback.

Before opening a pull request, run:

```powershell
.\.venv\Scripts\python.exe -m pytest
cd web; npm run typecheck
npm run build; npm run test:e2e   # browser tests on throwaway servers (see README, Testing)
```

The local database (`data/customeriq.db`) is created on first run and is git-ignored. To start fresh, delete it, then load the synthetic demo dataset from **Data Management** in the web app (the Streamlit fallback loads it automatically on first launch).

## Guidelines

- **Put analysis in SQL.** New metrics belong in a new or existing file in `src/sql/queries/`. Each file needs the documented header (Purpose, Params, Returns, SQL techniques) and should use the `{{FILTERED_TX}}` / `{{HISTORY_TX}}` macros so date and segment filters apply consistently. `test_all_queries_have_documentation_header` enforces the header.
- **Bind every value.** Never format user input into SQL text.
- **Keep thresholds in `src/config.py`**, documented and validated.
- **Test against hand-calculated values.** Extend the known dataset in `tests/conftest.py`, or add a small fixture whose expected results you have worked out independently.
- **Insights must be data-backed.** A new rule in `src/insights/engine.py` needs a minimum-sample guard. It must return `None` rather than guess, and it must fill all four parts: observation, metric, why it matters, action.
- **Label synthetic data.** Anything derived from the demo generator must stay clearly marked as synthetic.
- Use type hints and keep functions small. Web app code stays in `web/src/` and Streamlit fallback code in `src/ui/`. Both get their numbers from `src/services/registry.py`.

## Pull requests

1. Create a feature branch.
2. Add or update tests, and make sure `python -m pytest` and `npm run typecheck` (in `web/`) pass.
3. Update the relevant documentation (README, SQL guide, methodology) when behaviour changes.
4. Describe *what* changed and *why* in the PR description.
