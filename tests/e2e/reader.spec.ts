import { test, expect } from "@playwright/test";
import { textPdf } from "../pdf";

test("lecteur intégré : dossiers, PDF multipage, zoom, rotation, révisions et images hors ligne", async ({
  page,
}) => {
  const jsErrors: string[] = [],
    externalRequests: string[] = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === "http://localhost:3107")
      void route.continue();
    else {
      externalRequests.push(route.request().url());
      void route.abort();
    }
  });
  if ((await (await page.request.get("/api/setup")).json()).required) {
    const setup = await page.request.post("/api/setup", {
      data: {
        name: "Florian Admin",
        email: "admin@example.test",
        password: "administrator-password",
        token: "e2e-setup-token-of-at-least-24-characters",
      },
    });
    expect(setup.status()).toBe(201);
  }
  const login = await page.request.post("/api/auth/login", {
    data: { email: "admin@example.test", password: "administrator-password" },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  async function post(url: string, data: unknown) {
    const response = await page.request.post(`/api${url}`, {
      headers: { "x-csrf-token": csrf },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const site = await post("/locations", { name: "Site lecteur", kind: "SITE" }),
    building = await post("/locations", {
      name: "Bâtiment lecteur",
      kind: "BUILDING",
      parentId: site.id,
    });
  const doc = await post("/documents", {
      name: "Plan PDF multipage",
      reference: "PDF-LECT",
      locationId: building.id,
    }),
    image = await post("/documents", {
      name: "Image du site",
      reference: "IMG-LECT",
      locationId: site.id,
    });
  async function upload(
    id: string,
    revision: string,
    name: string,
    buffer: Buffer,
    mimeType: string,
  ) {
    const result = await page.request.post(
      `/api/documents/${id}/versions?revision=${revision}`,
      {
        headers: { "x-csrf-token": csrf },
        multipart: { file: { name, mimeType, buffer } },
      },
    );
    expect(result.status(), await result.text()).toBe(201);
    return result.json();
  }
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nxoAAAAASUVORK5CYII=",
    "base64",
  );
  await upload(doc.id, "A", "ancien.png", png, "image/png");
  await upload(
    doc.id,
    "B",
    "plan.pdf",
    await textPdf("LECTEUR INTEGRE ELECTROPLAN", 2),
    "application/pdf",
  );
  await upload(image.id, "A", "photo.png", png, "image/png");
  await page.goto("/");
  await page.getByRole("button", { name: "▤ Documents", exact: true }).click();
  await page
    .getByRole("button", { name: "Lecteur de plans", exact: true })
    .click();
  const reader = page.getByRole("dialog", { name: "Lecteur de documents" });
  await reader.getByRole("button", { name: /Bâtiment lecteur/ }).click();
  await reader.getByRole("button", { name: /Plan PDF multipage/ }).click();
  let canvas = reader.getByRole("img", { name: "Plan PDF multipage — page 1" });
  await expect(canvas).toHaveAttribute("data-rendered", "true", {
    timeout: 20000,
  });
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => {
      const pixels = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i] < 100 &&
          pixels[i + 1] < 100 &&
          pixels[i + 2] < 100 &&
          pixels[i + 3] > 0
        )
          return true;
      return false;
    }),
  ).toBe(true);
  await reader
    .getByRole("button", { name: "Page suivante", exact: true })
    .click();
  canvas = reader.getByRole("img", { name: "Plan PDF multipage — page 2" });
  await expect(canvas).toHaveAttribute("data-rendered", "true");
  await expect(reader.getByLabel("Page PDF")).toHaveValue("2");
  await reader.getByLabel("Zoom du document").selectOption("1.5");
  await expect(canvas).toHaveAttribute("data-rendered", "true");
  const width = await canvas.getAttribute("width");
  await reader.getByRole("button", { name: "Pivoter le document" }).click();
  await expect(canvas).toHaveAttribute("data-rendered", "true");
  await expect.poll(() => canvas.getAttribute("width")).not.toBe(width);
  await reader.getByRole("button", { name: "Dossiers à droite" }).click();
  const explorer = await reader
      .getByRole("region", { name: "Dossiers du patrimoine" })
      .boundingBox(),
    center = await reader
      .getByRole("region", { name: "Document ouvert" })
      .boundingBox();
  expect(explorer!.x).toBeGreaterThan(center!.x);
  await page.screenshot({
    path: "artifacts/electroplan-reader-pdf.png",
    fullPage: true,
  });
  const revisions = await reader
    .getByLabel("Révision affichée")
    .locator("option")
    .all();
  await reader.getByLabel("Révision affichée").selectOption({ label: "A" });
  await expect(
    reader.getByRole("img", { name: "Plan PDF multipage", exact: true }),
  ).toBeVisible();
  await reader.getByRole("button", { name: /Image du site/ }).click();
  await expect(
    reader.getByRole("img", { name: "Image du site", exact: true }),
  ).toBeVisible();
  await reader.getByRole("button", { name: "Agrandir le zoom" }).click();
  await expect(reader.getByLabel("Zoom du document")).toHaveValue("1.25");
  await page.setViewportSize({ width: 390, height: 844 });
  await reader.getByRole("button", { name: "Masquer les dossiers" }).click();
  await expect(
    reader.getByRole("region", { name: "Dossiers du patrimoine" }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/electroplan-reader-mobile.png",
    fullPage: true,
  });
  await reader.getByRole("button", { name: "Fermer le lecteur" }).click();
  await expect(reader).toHaveCount(0);
  expect(jsErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
