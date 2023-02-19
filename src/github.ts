// Modified from: https://github.com/slavcodev/coverage-monitor-action

// Not needed for now, but could be useful
// const createStatus = async ({ client, context, sha, status }) =>
// 	client.repos.createCommitStatus({
// 		...context.repo,
// 		sha,
// 		...status,
// 	})

// Every comment written by our action will have this hidden
// header on top, and will be used to identify which comments
// to update/delete etc

import { GitHub } from "@actions/github/lib/utils.js";
import { Context } from "@actions/github/lib/context.js";

export type OktokitClient = InstanceType<typeof GitHub>;
const appendHiddenHeaderToComment = (body, hiddenHeader) => hiddenHeader + body;

const listComments = async (
    client: OktokitClient,
    repo: Context["repo"],
    prNumber: number,
    hiddenHeader: string,
) => {
    const { data: existingComments } = await client.issues.listComments({
        ...repo,
        issue_number: prNumber,
    });

    return existingComments.filter(({ body }) =>
        body?.startsWith(hiddenHeader),
    );
};

const insertComment = (
    client: OktokitClient,
    repo: Context["repo"],
    prNumber: number,
    body: string,
    hiddenHeader: string,
) =>
    client.issues.createComment({
        ...repo,
        issue_number: prNumber,
        body: appendHiddenHeaderToComment(body, hiddenHeader),
    });

const updateComment = (
    client: OktokitClient,
    repo: Context["repo"],
    body: string,
    commentId: number,
    hiddenHeader: string,
) =>
    client.issues.updateComment({
        ...repo,
        comment_id: commentId,
        body: appendHiddenHeaderToComment(body, hiddenHeader),
    });

const deleteComments = (
    client: OktokitClient,
    repo: Context["repo"],
    comments: { id: number }[],
) =>
    Promise.all(
        comments.map(({ id }) =>
            client.issues.deleteComment({
                ...repo,
                comment_id: id,
            }),
        ),
    );

export const upsertComment = async (
    client: OktokitClient,
    repo: Context["repo"],
    prNumber: number,
    body: string,
    hiddenHeader: string,
) => {
    const existingComments = await listComments(
        client,
        repo,
        prNumber,
        hiddenHeader,
    );
    const last = existingComments.pop();

    await deleteComments(client, repo, existingComments);

    return last
        ? updateComment(client, repo, body, last.id, hiddenHeader)
        : insertComment(client, repo, prNumber, body, hiddenHeader);
};
