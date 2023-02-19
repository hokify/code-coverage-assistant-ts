import {
    GetObjectCommand,
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
