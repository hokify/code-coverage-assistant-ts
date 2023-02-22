import { readdirSync, statSync, promises } from "node:fs";
import * as path from "node:path";
import { Context } from "@actions/github/lib/context.js";
import { S3Client } from "@aws-sdk/client-s3";
import { basename } from "node:path";
import { LcovData, parse } from "./lcov.js";
import { OktokitClient, upsertComment } from "./github.js";
import { generateDiffForMonorepo } from "./comment.js";
import {
    deleteFile,
    downloadFile,
    getFileList,
    renameFile,
    uploadFile,
} from "./storage.js";
/**
 * Find all files inside a dir, recursively.
 * @function getLocalLcovFileList
 * @param  {string} dir Dir path string.
 * @return {string[{<package_name>: <path_to_lcov_file>}]} Array with lcove file names with package names as key.
 */

export type FileList = { packageName: string; path: string }[];
export type LvocList = { packageName: string; lcov: LcovData }[];
export function getLocalLcovFileList(
    dir: string,
    filelist?: FileList,
    deepness = 0,
) {
    let fileArray = filelist || [];
    readdirSync(dir).forEach((file) => {
        const isDir = statSync(path.join(dir, file)).isDirectory();
        if (isDir && file !== "node_modules" && deepness < 10) {
            fileArray = getLocalLcovFileList(
                path.join(dir, file),
                fileArray,
                deepness + 1,
            );
        } else if (!isDir && file.endsWith("lcov.info")) {
            const packageName = dir.split("/")[1];
            const existing = fileArray.find(
                (f) => f.packageName === packageName,
            );
            if (existing) {
                console.warn(
                    `found more than one lcov file for ${packageName}: ${path.join(
                        dir,
                        file,
                    )}`,
                );
            }
            fileArray.push({
                packageName,
                path: path.join(dir, file),
            });
        }
    });

    return fileArray;
}

function filePath(
    repo: Context["repo"],
    base: string,
    prNumber: number | undefined,
    monorepoBasePath: string,
    file?: { packageName: string },
) {
    return `${repo.owner}/${repo.repo}/${base}/${
        prNumber ? `${prNumber}/` : ""
    }${monorepoBasePath}/${file ? `${file.packageName}.lcov.info` : ""}`;
}

export async function retrieveLocalLcovFiles(
    fileList: FileList,
): Promise<{ lcovArrayForMonorepo: LvocList }> {
    const lcovArrayForMonorepo: LvocList = [];
    for (const file of fileList) {
        try {
            const rLcove = await promises.readFile(file.path, "utf8");
            const data = await parse(rLcove);
            lcovArrayForMonorepo.push({
                packageName: file.packageName,
                lcov: data,
            });
        } catch (error) {
            try {
                const stats = statSync(file.path);
                console.error(
                    `The LCOV file ${JSON.stringify(
                        file,
                    )} cannot be parsed. The file may be generated empty, filesize in bytes: ${
                        stats.size
                    }`,
                );
            } catch (err) {
                console.error(
                    `The LCOV file ${JSON.stringify(
                        file,
                    )} cannot be parsed. The file does not exist?`,
                );
            }

            throw error;
        }
    }

    return {
        lcovArrayForMonorepo,
    };
}

export async function retrieveTemporaryLcovFiles(
    s3Client: S3Client,
    s3Bucket: string,
    repo: Context["repo"],
    prNumber: number,
    monorepoBasePath: string,
    base: string,
): Promise<{ lcovArrayForMonorepo: LvocList }> {
    const lcovArrayForMonorepo: LvocList = [];

    const files = await getFileList(
        s3Client,
        s3Bucket,
        filePath(repo, base, prNumber, monorepoBasePath),
    );
    await Promise.all(
        files.map(async (file) => {
            if (!file.Key) return;
            const remotePath =
                filePath(repo, base, prNumber, monorepoBasePath, undefined) +
                basename(file.Key);
            // eslint-disable-next-line no-console
            console.info("getting temporary lcov file from", remotePath);

            // console.log("file", file.name, file.path, rLcove.length);
            const data = await downloadFile(s3Client, s3Bucket, remotePath);

            if (!data) {
                throw new Error(`failed to download: ${remotePath}`);
            }
            try {
                lcovArrayForMonorepo.push({
                    packageName: basename(file.Key).replace(/.lcov.info$/, ""),
                    lcov: await parse(data),
                });
            } catch (err) {
                console.error(
                    `failed to parse ${remotePath}: ${err} (filesize in bytes: ${data.length})`,
                );
            }
        }),
    );
    return { lcovArrayForMonorepo };
}

export async function retrieveLcovBaseFiles(
    fileList: { packageName: string }[],
    s3Client: S3Client,
    s3Bucket: string,
    repo: Context["repo"],
    monorepoBasePath: string,
    base: string,
    mainBase: string,
): Promise<{ lcovBaseArrayForMonorepo: LvocList }> {
    const lcovBaseArrayForMonorepo: LvocList = [];
    await Promise.all(
        fileList.map(async (file) => {
            try {
                // eslint-disable-next-line no-console
                console.info(
                    "getting base file from",
                    filePath(repo, base, undefined, monorepoBasePath, file),
                );
                const data = await downloadFile(
                    s3Client,
                    s3Bucket,
                    filePath(repo, base, undefined, monorepoBasePath, file),
                );
                if (!data) {
                    throw new Error(
                        `failed to download: ${filePath(
                            repo,
                            base,
                            undefined,
                            monorepoBasePath,
                            file,
                        )}`,
                    );
                }
                lcovBaseArrayForMonorepo.push({
                    packageName: file.packageName,
                    lcov: await parse(data),
                });
            } catch (err) {
                // eslint-disable-next-line no-console
                console.log(err);
                try {
                    if (base === mainBase) {
                        throw err;
                    }
                    const data = await downloadFile(
                        s3Client,
                        s3Bucket,
                        filePath(
                            repo,
                            mainBase,
                            undefined,
                            monorepoBasePath,
                            file,
                        ),
                    );
                    if (!data) {
                        throw new Error(
                            `failed to download: ${filePath(
                                repo,
                                mainBase,
                                undefined,
                                monorepoBasePath,
                                file,
                            )}`,
                        );
                    }
                    lcovBaseArrayForMonorepo.push({
                        packageName: file.packageName,
                        lcov: await parse(data),
                    });
                } catch (secondTryErr) {
                    console.warn(
                        `no base lcov file found for ${file.packageName}: ${secondTryErr}`,
                    );
                }
            }
        }),
    );

    return {
        lcovBaseArrayForMonorepo,
    };
}

export async function setTemporarLvocFilesAsBase(
    s3Client: S3Client,
    s3Bucket: string,
    repo: Context["repo"],
    prNumber: number,
    monorepoBasePath: string,
    base: string,
) {
    // rename them to base
    const files = await getFileList(
        s3Client,
        s3Bucket,
        filePath(repo, base, prNumber, monorepoBasePath),
    );
    await Promise.all(
        files.map(async (file) => {
            if (!file.Key) return;
            // console.log("file", file.name, file.path, rLcove.length);
            await renameFile(
                s3Client,
                s3Bucket,
                filePath(repo, base, prNumber, monorepoBasePath, undefined) +
                    basename(file.Key),
                filePath(repo, base, undefined, monorepoBasePath, undefined) +
                    basename(file.Key),
            );
        }),
    );
    return files.length;
}

export async function uploadTemporaryLvocFiles(
    fileList: FileList,
    s3Client: S3Client,
    s3Bucket: string,
    repo: Context["repo"],
    prNumber: number,
    monorepoBasePath: string,
    base: string,
) {
    // upload them
    await Promise.all(
        fileList.map(async (file) => {
            const rLcove = await promises.readFile(file.path, "utf8");
            // console.log("file", file.name, file.path, rLcove.length);
            await uploadFile(
                s3Client,
                s3Bucket,
                filePath(repo, base, prNumber, monorepoBasePath, file),
                rLcove,
            );
        }),
    );
}

export async function generateReport(
    client: OktokitClient,
    lcovArrayForMonorepo: LvocList,
    lcovBaseArrayForMonorepo: LvocList = [],
    monorepoBasePath: string,
    repo: Context["repo"],
    prNumber: number,
    base: string,
    threshold = 0.05,
) {
    const options = {
        // repository: context.payload.repository?.full_name,
        // commit: context.payload.pull_request?.head.sha,
        // prefix: `${process.env.GITHUB_WORKSPACE}/`,
        // head: context.payload.pull_request?.head.ref,
        base,
        folder: monorepoBasePath,
        threshold,
    };

    const diff = generateDiffForMonorepo(
        lcovArrayForMonorepo,
        lcovBaseArrayForMonorepo,
        options,
    );

    await upsertComment(
        client,
        repo,
        prNumber,
        diff.text,
        `<!-- monorepo-code-coverage-assistant--${monorepoBasePath} -->`,
    );

    return {
        count: lcovArrayForMonorepo.length,
        thresholdReached: diff.thresholdReached,
    };
}

export async function cleanUpNonchangedTemporaryLcovs(
    s3Client: S3Client,
    s3Bucket: string,
    lcovArrayForMonorepo: LvocList,
    lcovBaseArrayForMonorepo: LvocList = [],
    repo: Context["repo"],
    prNumber: number,
    monorepoBasePath: string,
    base: string,
) {
    let cleaned = 0;
    // remove temporary coverage files that are equal to the base
    await Promise.all(
        lcovArrayForMonorepo.map(async (lcov) => {
            const baseLcov = lcovBaseArrayForMonorepo.find(
                (l) => l.packageName === lcov.packageName,
            );
            if (
                baseLcov &&
                JSON.stringify(baseLcov.lcov) === JSON.stringify(lcov.lcov)
            ) {
                // eslint-disable-next-line no-console
                console.info(
                    "removing non needed temporary lcov file (identical to base) for ",
                    lcov.packageName,
                );
                cleaned += 1;
                await deleteFile(
                    s3Client,
                    s3Bucket,
                    filePath(repo, base, prNumber, monorepoBasePath, lcov),
                );
            }
        }),
    );
    return cleaned;
}
