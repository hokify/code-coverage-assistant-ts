// eslint-disable-next-line import/no-unused-modules
import * as core from "@actions/core";
import * as github from "@actions/github";
import { diffForMonorepo } from "./comment";
import { upsertComment } from "./github";
import { assistent } from "./assistent";

const main = async () => {
    const { context } = github;

    const token = core.getInput("github-token");
    const appName = core.getInput("app-name");
    // Add base path for monorepo
    const monorepoBasePath = core.getInput("monorepo-base-path");

    if (!monorepoBasePath) {
        // eslint-disable-next-line no-console
        console.log(`No monorepo-base-path specified', exiting...`);

        return;
    }

    const { lcovArrayForMonorepo, lcovBaseArrayForMonorepo } = await assistent(
        monorepoBasePath,
    );

    const options = {
        repository: context.payload.repository?.full_name,
        commit: context.payload.pull_request?.head.sha,
        prefix: `${process.env.GITHUB_WORKSPACE}/`,
        head: context.payload.pull_request?.head.ref,
        base: context.payload.pull_request?.base.ref,
        appName,
        folder: monorepoBasePath.split("/")[1],
    };

    const client = github.getOctokit(token);

    await upsertComment({
        client,
        context,
        prNumber: context.payload.pull_request?.number,
        body: diffForMonorepo(
            lcovArrayForMonorepo,
            lcovBaseArrayForMonorepo,
            options,
        ),
        hiddenHeader: appName
            ? `<!-- ${appName}-code-coverage-assistant -->`
            : `<!-- monorepo-code-coverage-assistant ${
                  monorepoBasePath.split("/")[1]
              } -->`,
    });
};

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.log(err);
    core.setFailed(err.message);
});
