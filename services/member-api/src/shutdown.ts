export interface ClosableMemberApi {
  close(): Promise<unknown>;
}

/** Close the server without allowing shutdown failures to become unhandled rejections. */
export async function closeMemberApi(
  app: ClosableMemberApi,
  reportFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await app.close();
  } catch (error) {
    reportFailure(error);
  }
}
