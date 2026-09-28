# Education–Income Correlation Curve

An animated, in-browser data pipeline that shows how a person's hourly wage changes with **education** and **experience**. You upload a CSV and watch each stage run in turn:

```
📁 Upload → 🔍 Validation → 🧹 Cleaning → ⚙️ Transform → 🤖 ML model → 📊 Prediction
```

Dots representing bundles of rows travel down the pipe between stations. Rows that fail cleaning are colour-coded by reason and thrown out, rows turn green when features are added, swirl around the model while it trains, and leave as orange predictions.

## Run it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

It also works on GitHub Pages as-is. Everything runs client-side, so no data leaves the browser.

## What each stage does

| Stage | What happens |
|---|---|
| Upload | Parses the CSV (quoted fields, `NA`/`nan`/empty → missing) and previews the first rows. |
| Validation | Checks that the required columns `wage`, `educ`, `exper` exist, that the columns are numeric, and that values fall in plausible ranges. Optional predictors `tenure`, `female`, `married` are used when present. |
| Cleaning | Drops rows with a missing required value, invalid or out-of-range values, and exact duplicates. Fills missing optional predictors with the median. A waffle chart shows every row and why it was removed. Tick **Add messy rows** to inject duplicates, blanks and bad values so this stage has work to do. |
| Transform | Creates `lwage = ln(wage)` (fixes the right skew; before and after histograms are shown), `expersq = exper²` (lets the curve bend), and `educ_level` buckets. |
| ML model | 80/20 train/test split. Learns the weights with batch gradient descent on standardised features (loss curve animates), then checks them against the exact least-squares solution, which also supplies standard errors and p-values. |
| Prediction | Scores the held-out rows (R², MAE, RMSE) and builds the results dashboard. |

## Results dashboard

- **Sample regression curves vs. the estimated population curve.** 40 bootstrap resamples each give a sample regression function (thin lines). The thick line is the estimate of the population curve, with a 95% band.
- **Wage over a career** for 10, 12 and 16 years of education, showing where experience stops paying off.
- **Wage predictor.** Sliders return a predicted wage, a 95% range for the average person with that profile, and a 95% range for one individual.
- Predicted vs. actual on unseen rows, effect sizes with confidence intervals, a predictions table, and a CSV download.

## The model

```
ln(wage) = β0 + β1·educ + β2·exper + β3·exper² + β4·tenure + β5·female + β6·married + ε
```

Predictions are converted back to dollars with Duan's smearing estimator. On the bundled `wage1.csv` (526 workers), fitting on all rows gives:

| | effect on hourly wage |
|---|---|
| +1 year of education | **+8.3%** |
| +1 year with the same employer | +1.6% |
| Experience | rises, then peaks at **~25 years** |
| Female (vs. comparable male) | −25% |

These are associations, not causal effects.

## Project layout

```
index.html               page structure
css/style.css            styles (light and dark)
js/pipeline.js           pure data pipeline: parse, validate, clean, transform, train, predict
js/flow.js               canvas particle animation for the pipe
js/charts.js             small dependency-free SVG charts with tooltips
js/app.js                runs the stages and renders cards and results
js/sample-data.js        data/wage1.csv embedded, so it works from file://
data/wage1.csv           sample dataset
scripts/build_sample.py  regenerates js/sample-data.js from data/wage1.csv
scripts/reference_model.py  numpy/pandas cross-check of the coefficients
```
