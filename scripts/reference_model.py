"""Reference implementation of the site's model, used to cross-check the browser numbers.

Fits ln(wage) = b0 + b1*educ + b2*exper + b3*exper^2 + b4*tenure + b5*female + b6*married
by ordinary least squares on the full cleaned dataset and prints the coefficients.

    pip install pandas numpy
    python scripts/reference_model.py [path/to/file.csv]
"""
import sys

import numpy as np
import pandas as pd

path = sys.argv[1] if len(sys.argv) > 1 else "data/wage1.csv"
df = pd.read_csv(path)

# Cleaning (mirrors js/pipeline.js): drop missing required values, invalid ranges, duplicates.
df = df.dropna(subset=["wage", "educ", "exper"])
df = df[(df.wage > 0) & df.educ.between(0, 25) & df.exper.between(0, 70)]
df = df.drop_duplicates()
for col in ["tenure", "female", "married"]:
    if col in df:
        df[col] = df[col].fillna(df[col].median())

# Transform
df["lwage"] = np.log(df.wage)
df["expersq"] = df.exper**2
features = ["educ", "exper", "expersq"] + [c for c in ["tenure", "female", "married"] if c in df]

X = np.column_stack([np.ones(len(df))] + [df[f] for f in features])
y = df.lwage.to_numpy()
beta, *_ = np.linalg.lstsq(X, y, rcond=None)
resid = y - X @ beta
sigma2 = resid @ resid / (len(y) - X.shape[1])
se = np.sqrt(np.diag(sigma2 * np.linalg.inv(X.T @ X)))
r2 = 1 - resid @ resid / ((y - y.mean()) @ (y - y.mean()))

print(f"rows used: {len(df)}   R^2 (log wage): {r2:.4f}")
print(f"{'feature':<10}{'coef':>10}{'std err':>10}{'% effect':>10}")
for name, b, s in zip(["intercept"] + features, beta, se):
    print(f"{name:<10}{b:>10.5f}{s:>10.5f}{100 * (np.exp(b) - 1):>9.2f}%")
b = dict(zip(["intercept"] + features, beta))
print(f"wage peaks at {-b['exper'] / (2 * b['expersq']):.1f} years of experience")
