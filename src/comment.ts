import { b, fragment, table, tbody, tr, th } from "./html";
import { percentage } from "./lcov";

/**
 * Compares two arrays of objects and returns with unique lines update
 * @param {number} pdiff value from diff percentage
 * @returns {string} emoji string for negative/positive pdiff
 */
const renderEmoji = (pdiff) => {
    if (pdiff.toFixed(2) < 0) return "❌";

    return "✅";
};

/**
 * Github comment for monorepo
 * @param {Array<{packageName, lcovPath}>} lcovArrayForMonorepo
 * @param {{Array<{packageName, lcovBasePath}>}} lcovBaseArrayForMonorepo
 * @param {*} options
 */
const commentForMonorepo = (
    lcovArrayForMonorepo,
    lcovBaseArrayForMonorepo,
    options,
) => {
    const { base, folder } = options;
    const rows = lcovArrayForMonorepo.map((lcovObj) => {
        const baseLcov = lcovBaseArrayForMonorepo.find(
            (el) => el.packageName === lcovObj.packageName,
        );

        const pbefore = baseLcov ? percentage(baseLcov.lcov) : 0;
        const pafter = baseLcov ? percentage(lcovObj.lcov) : 0;
        const pdiff = pafter - pbefore;
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
    )} <p></p>`;

    return fragment(title, html);
};

/**
 * Diff in coverage percentage for monorepo
 * @param {Array<{packageName, lcovPath}>} lcovArrayForMonorepo
 * @param {{Array<{packageName, lcovBasePath}>}} lcovBaseArrayForMonorepo
 * @param {*} options
 */
export const diffForMonorepo = (
    lcovArrayForMonorepo,
    lcovBaseArrayForMonorepo,
    options,
) =>
    commentForMonorepo(lcovArrayForMonorepo, lcovBaseArrayForMonorepo, options);
