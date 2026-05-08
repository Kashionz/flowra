export const FAKE_USER = {
  id: "fake-uuid",
  email: "ai-test@example.com",
  aud: "authenticated",
  role: "authenticated",
};

const STORAGE_KEY = "sb-hxhcjiiiuknelfsmumcy-auth-token";

export async function mockAiAccess(page) {
  const session = {
    access_token: "fake-jwt",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: FAKE_USER,
  };

  await page.addInitScript(
    ({ storageKey, sessionPayload }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(sessionPayload));
      window.localStorage.setItem(
        `${storageKey}-user`,
        JSON.stringify({ user: sessionPayload.user }),
      );
    },
    { storageKey: STORAGE_KEY, sessionPayload: session },
  );

  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: FAKE_USER }),
    });
  });

  await page.route("**/rest/v1/flowra_backups**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: route.request().method() === "HEAD" ? "" : "[]",
      headers: {
        "content-range": "0-0/0",
      },
    });
  });
}
