"""
Generate golden reference files for TypeScript statistical test validation.
"""
import json
import numpy as np
from scipy import stats
from scipy.stats import beta as beta_dist
from statsmodels.stats.multitest import multipletests

def generate_fisher_references():
    cases = []
    tables = [
        [[10, 5], [3, 12]],
        [[0, 10], [10, 0]],
        [[5, 5], [5, 5]],
        [[1, 0], [0, 1]],
        [[100, 50], [30, 120]],
        [[0, 0], [5, 5]],
        [[3, 0], [0, 4]],
    ]
    for table in tables:
        t = np.array(table)
        oddsratio, pvalue = stats.fisher_exact(t)
        cases.append({
            "table": table,
            "p_value": float(pvalue),
            "odds_ratio": float(oddsratio) if np.isfinite(oddsratio) else None,
        })
    return cases

def generate_fdr_references():
    cases = []
    pvalue_sets = [
        [0.001, 0.01, 0.05, 0.1, 0.5],
        [0.0001, 0.001, 0.01, 0.1, 0.2, 0.3, 0.5, 0.8],
        [0.5, 0.5, 0.5],
        [0.01],
    ]
    for pvals in pvalue_sets:
        reject, corrected, _, _ = multipletests(pvals, method='fdr_bh')
        cases.append({
            "p_values": pvals,
            "q_values": [float(q) for q in corrected],
        })
    return cases

def generate_weight_references():
    cases = []
    mafs = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5]
    for maf in mafs:
        w = float(beta_dist.pdf(maf, 1, 25))
        cases.append({"maf": maf, "beta_1_25_weight": w})
    return cases

def generate_logistic_references():
    np.random.seed(42)
    cases = []
    import statsmodels.api as sm

    n = 50
    burden = np.random.exponential(1.0, n)
    logits = -1.0 + 1.5 * burden
    y = (np.random.uniform(size=n) < 1.0 / (1.0 + np.exp(-logits))).astype(float)
    X = sm.add_constant(burden)
    model = sm.Logit(y, X)
    result = model.fit(disp=False)
    cases.append({
        "name": "clear_signal_no_covariates",
        "burden": burden.tolist(),
        "y": y.tolist(),
        "covariates": None,
        "beta": float(result.params[1]),
        "se": float(result.bse[1]),
        "p_value": float(result.pvalues[1]),
        "ci_lower": float(result.conf_int()[1][0]),
        "ci_upper": float(result.conf_int()[1][1]),
        "converged": True,
    })

    covar = np.random.normal(0, 1, n)
    logits2 = -1.0 + 1.5 * burden + 0.5 * covar
    y2 = (np.random.uniform(size=n) < 1.0 / (1.0 + np.exp(-logits2))).astype(float)
    X2 = sm.add_constant(np.column_stack([burden, covar]))
    model2 = sm.Logit(y2, X2)
    result2 = model2.fit(disp=False)
    cases.append({
        "name": "with_covariate",
        "burden": burden.tolist(),
        "y": y2.tolist(),
        "covariates": covar.tolist(),
        "beta": float(result2.params[1]),
        "se": float(result2.bse[1]),
        "p_value": float(result2.pvalues[1]),
        "ci_lower": float(result2.conf_int()[1][0]),
        "ci_upper": float(result2.conf_int()[1][1]),
        "converged": True,
    })
    return cases

def generate_firth_references():
    cases = []
    burden = [1.0, 2.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    y = [1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    cases.append({
        "name": "perfect_separation",
        "burden": burden,
        "y": y,
        "covariates": None,
        "standard_logit_converged": False,
        "firth_required": True,
    })

    burden2 = [1.0, 2.0, 1.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    y2 = [1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    cases.append({
        "name": "quasi_separation",
        "burden": burden2,
        "y": y2,
        "covariates": None,
        "firth_required": True,
    })
    return cases

if __name__ == "__main__":
    import os
    out_dir = "tests/fixtures/golden"
    os.makedirs(out_dir, exist_ok=True)
    refs = {
        "fisher-reference.json": generate_fisher_references(),
        "fdr-reference.json": generate_fdr_references(),
        "weights-reference.json": generate_weight_references(),
        "logistic-reference.json": generate_logistic_references(),
        "firth-reference.json": generate_firth_references(),
    }
    for filename, data in refs.items():
        path = os.path.join(out_dir, filename)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Wrote {path}")
