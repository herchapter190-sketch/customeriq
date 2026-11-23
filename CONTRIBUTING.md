# Contributing

Thank you for your interest in improving CustomerIQ.

## Development setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest
python -m streamlit run app.py --server.port 8517
```

The local database (`data/customeriq.db`) is created on first run and is git-ignored. Delete it to start fresh with the synthetic demo dataset.

## Guidelines

- **Put analysis in SQL.** New metrics belong in a new or existing file in `src/sql/queries/`. Each file needs the documented header (Purpose, Params, Returns, SQL techniques) and should use the `{{FILTERED_TX}}` / `{{HISTORY_TX}}` macros so date and segment filters apply consistently. `test_all_queries_have_documentation_header` enforces the header.
- **Bind every value.** Never format user input into SQL text.
- **Keep thresholds in `src/config.py`**, documented and validated.
- **Test against hand-calculated values.** Extend the known dataset in `tests/conftest.py`, or add a small fixture whose expected results you have worked out independently.
- **Insights must be data-backed.** A new rule in `src/insights/engine.py` needs a minimum-sample guard. It must return `None` rather than guess, and it must fill all four parts: observation, metric, why it matters, action.
- **Label synthetic data.** Anything derived from the demo generator must stay clearly marked as synthetic.
- Use type hints and keep functions small. UI code stays in `src/ui/`.

## Pull requests

1. Create a feature branch.
2. Add or update tests, and make sure `python -m pytest` passes.
3. Update the relevant documentation (README, SQL guide, methodology) when behaviour changes.
4. Describe *what* changed and *why* in the PR description.
