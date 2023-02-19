import lcov from "lcov-parse";

export type LcovData = { lines: { hit: number; found: number } }[];
// Parse lcov string into lcov data
export const parse = (data) =>
    new Promise<LcovData>((resolve, reject) => {
        lcov(data, (err, res) => {
            if (err) {
                reject(err);

                return;
            }
            resolve(res);
        });
    });

// Get the total coverage percentage from the lcov data.
export const percentage = (lcovData: LcovData) => {
    let hit = 0;
    let found = 0;
    for (const entry of lcovData) {
        hit += entry.lines.hit;
        found += entry.lines.found;
    }

    return (hit / found) * 100;
};
