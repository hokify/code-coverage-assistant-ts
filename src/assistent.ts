import { readdirSync, statSync, promises } from "node:fs";
import * as path from "node:path";
import { parse } from "./lcov";

/**
 * Find all files inside a dir, recursively.
 * @function getLcovFiles
 * @param  {string} dir Dir path string.
 * @return {string[{<package_name>: <path_to_lcov_file>}]} Array with lcove file names with package names as key.
 */

type FileList = { name: string; path: string }[];
type LvocList = { packageName: string; lcov: unknown }[];
const getLcovFiles = (dir: string, filelist?: FileList) => {
    let fileArray = filelist || [];
    readdirSync(dir).forEach((file) => {
        fileArray = statSync(path.join(dir, file)).isDirectory()
            ? getLcovFiles(path.join(dir, file), fileArray)
            : fileArray
                  .filter((f) => f.path.includes("lcov.info"))
                  .concat({
                      name: dir.split("/")[1],
                      path: path.join(dir, file),
                  });
    });

    return fileArray;
};

/**
 * Find all files inside a dir, recursively for base branch.
 * @function getLcovBaseFiles
 * @param  {string} dir Dir path string.
 * @return {string[{<package_name>: <path_to_lcov_file>}]} Array with lcove file names with package names as key.
 */
const getLcovBaseFiles = (dir: string, filelist?: FileList) => {
    let fileArray = filelist || [];
    readdirSync(dir).forEach((file) => {
        fileArray = statSync(path.join(dir, file)).isDirectory()
            ? getLcovBaseFiles(path.join(dir, file), fileArray)
            : fileArray
                  .filter((f) => f.path.includes("lcov-base"))
                  .concat({
                      name: dir.split("/")[1],
                      path: path.join(dir, file),
                  });
    });

    return fileArray;
};

export async function assistent(monorepoBasePath: string) {
    const lcovArray = getLcovFiles(monorepoBasePath);
    const lcovBaseArray = getLcovBaseFiles(monorepoBasePath);

    const lcovArrayForMonorepo: LvocList = [];
    const lcovBaseArrayForMonorepo: LvocList = [];
    for (const file of lcovArray) {
        if (file.path.includes(".info")) {
            try {
                const rLcove = await promises.readFile(file.path, "utf8");
                const data = await parse(rLcove);
                lcovArrayForMonorepo.push({
                    packageName: file.name,
                    lcov: data,
                });
            } catch (error) {
                // eslint-disable-next-line no-console
                console.log(
                    `The LCOV file from the project ${file.name} cannot be parsed. Either the file does not exist or it has been generated empty`,
                );
                throw error;
            }
        }
    }

    for (const file of lcovBaseArray) {
        if (file.path.includes(".info")) {
            const rLcovBase = await promises.readFile(file.path, "utf8");
            const data = await parse(rLcovBase);
            lcovBaseArrayForMonorepo.push({
                packageName: file.name,
                lcov: data,
            });
        }
    }

    return {
        lcovArrayForMonorepo,
        lcovBaseArrayForMonorepo,
    };
}
