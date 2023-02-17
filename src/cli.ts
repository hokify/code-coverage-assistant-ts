import * as process from "process";
import { diffForMonorepo } from "./comment";
import { assistent } from "./assistent";

const main = async () => {
    // const file = process.argv[2];
    const monorepoBasePath = process.argv[2];

    // eslint-disable-next-line no-console
    console.log("monorepoBasePath", monorepoBasePath);

    const { lcovArrayForMonorepo, lcovBaseArrayForMonorepo } = await assistent(
        monorepoBasePath,
    );

    const options = {
        base: "base...",
        folder: monorepoBasePath.split("/")[1],
    };

    // eslint-disable-next-line no-console
    console.log("upsertComment", {
        body: diffForMonorepo(
            lcovArrayForMonorepo,
            lcovBaseArrayForMonorepo,
            options,
        ),
    });
};

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.log(err);
    process.exit(1);
});
