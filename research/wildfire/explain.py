"""SHAP explanations for the Random Forest and permutation importance for nearest neighbours."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import shap  # noqa: E402
from sklearn.inspection import permutation_importance  # noqa: E402


def shap_forest(model, X: pd.DataFrame, figures, seed: int = 29) -> dict:
    explainer = shap.TreeExplainer(model)
    values = explainer.shap_values(X, check_additivity=False)
    values = values[:, :, 1] if values.ndim == 3 else values[1]
    importance = pd.Series(np.abs(values).mean(axis=0), index=X.columns).sort_values(ascending=False)

    plt.figure()
    shap.summary_plot(values, X, show=False, max_display=15)
    plt.title("Random Forest: SHAP values on test rows")
    plt.tight_layout()
    plt.savefig(figures / "shap_beeswarm.png", dpi=140)
    plt.close("all")

    plt.figure(figsize=(7, 5))
    importance.head(15)[::-1].plot.barh(color="#d9622b")
    plt.xlabel("mean |SHAP| (probability units)")
    plt.title("Which features move the forecast")
    plt.tight_layout()
    plt.savefig(figures / "shap_importance.png", dpi=140)
    plt.close("all")

    # One concrete explanation: the highest-scoring true discovery in the sample.
    base = explainer.expected_value
    base = float(base[1] if np.ndim(base) else base)
    return {
        "mean_abs_shap": {k: float(v) for k, v in importance.items()},
        "base_value": base,
        "values": values,
    }


def knn_permutation(model, X: pd.DataFrame, y: np.ndarray, seed: int = 29) -> dict:
    result = permutation_importance(model, X, y, scoring="average_precision", n_repeats=3, random_state=seed, n_jobs=1, max_samples=1.0)
    series = pd.Series(result.importances_mean, index=X.columns).sort_values(ascending=False)
    return {k: float(v) for k, v in series.items()}
