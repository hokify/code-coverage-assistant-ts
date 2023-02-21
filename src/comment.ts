import { b, fragment, table, tbody, tr, th } from "./html.js";
import { percentage } from "./lcov.js";
import { LvocList } from "./app.js";

const renderEmoji = (pdiff: number) => {
    if (pdiff < 0.01) return ":x:";

    if (pdiff > 0.01) return ":heavy_check_mark:";

    return ":white_check_mark:";
};

/**
 * Diff in coverage percentage for monorepo
 * @param {Array<{packageName, lcovPath}>} lcovArrayForMonorepo
 * @param {{Array<{packageName, lcovBasePath}>}} lcovBaseArrayForMonorepo
 * @param {*} options
 */

export const generateDiffForMonorepo = (
    lcovArrayForMonorepo: LvocList,
    lcovBaseArrayForMonorepo: LvocList,
    options: { base: string; folder: string; threshold: number },
): { text: string; thresholdReached: number } => {
    const { base, folder } = options;
    let thresholdReached = 0;
    const rows = lcovArrayForMonorepo.map((lcovObj) => {
        const baseLcov = lcovBaseArrayForMonorepo.find(
            (el) => el.packageName === lcovObj.packageName,
        );

        const pbefore = baseLcov ? percentage(baseLcov.lcov) : 0;
        const pafter = baseLcov ? percentage(lcovObj.lcov) : 0;
        const pdiff = pafter - pbefore;

        if (pdiff < -options.threshold) {
            thresholdReached += 1;
        }
        const plus = pdiff > 0 ? "+" : "";

        let arrow = "";
        if (pdiff < 0) {
            arrow = "▾";
        } else if (pdiff > 0) {
            arrow = "▴";
        }

        const pdiffHtml = baseLcov
            ? th(
                  renderEmoji(pdiff),
                  " ",
                  arrow,
                  " ",
                  plus,
                  pdiff.toFixed(2),
                  "%",
                  pdiff > 10 ? " :green_heart:" : "",
              )
            : th(" N/A ");

        return tr(
            th(lcovObj.packageName),
            th(percentage(lcovObj.lcov).toFixed(2), "%"),
            pdiffHtml,
        );
    });

    const html = table(tbody(rows.join("")));

    const title = `Coverage for the ${b(folder)} folder after merging into ${b(
        base,
    )} ${
        thresholdReached
            ? `warning: ${b(`decresased for ${thresholdReached} packages`)}`
            : ":"
    } <p></p>`;

    return {
        text: fragment(title, html),
        thresholdReached,
    };
};
