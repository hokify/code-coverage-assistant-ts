import {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";

export async function uploadFile(
    s3Client: S3Client,
    bucket: string,
    file: string,
    body: string,
) {
    await s3Client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: file,
            Body: body,
        }),
    );
}

export async function renameFile(
    s3Client: S3Client,
    bucket: string,
    fileFrom: string,
    fileTo: string,
) {
    await s3Client.send(
        new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${fileFrom}`,
            Key: fileTo,
        }),
    );

    await s3Client.send(
        new DeleteObjectCommand({
            Bucket: bucket,
            Key: fileFrom,
        }),
    );
}

export async function getFileList(
    s3Client: S3Client,
    bucket: string,
    path: string,
) {
    const response = await s3Client.send(
        new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: path,
        }),
    );

    return response.Contents || [];
}

export async function downloadFile(
    s3Client: S3Client,
    bucket: string,
    file: string,
) {
    // Get the object from the Amazon S3 bucket. It is returned as a ReadableStream.
    const dataGet = await s3Client.send(
        new GetObjectCommand({
            Bucket: bucket,
            Key: file,
        }),
    );
    // Convert the ReadableStream to a string.
    const body = await dataGet.Body?.transformToString();

    return body;
}
