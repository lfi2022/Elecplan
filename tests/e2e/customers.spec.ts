import { test, expect } from "@playwright/test";

test("clients et patrimoine : création, rattachement, référence automatique et recherche hiérarchique", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if ((await (await page.request.get("/api/setup")).json()).required)
    expect(
      (
        await page.request.post("/api/setup", {
          data: {
            name: "Florian Admin",
            email: "admin@example.test",
            password: "administrator-password",
            token: "e2e-setup-token-of-at-least-24-characters",
          },
        })
      ).status(),
    ).toBe(201);
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: {
          email: "admin@example.test",
          password: "administrator-password",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "◇ Clients", exact: true }).click();
  await page.getByRole("button", { name: "+ Nouveau client" }).click();
  let dialog = page.getByRole("dialog", { name: "Créer un client" });
  await dialog.getByLabel("Nom du client").fill("Client Atelier");
  await dialog.getByLabel("Code client", { exact: true }).fill("atelier");
  await dialog.getByLabel("Préfixe documentaire").fill("atl-elec");
  await dialog
    .getByLabel("E-mail", { exact: true })
    .fill("contact@atelier.test");
  await dialog.getByRole("button", { name: "Enregistrer le client" }).click();
  await expect(
    page.getByRole("cell", {
      name: "ATL-ELEC-00001 Prochaine séquence : 00001",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "▦ Patrimoine", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Ajouter une localisation" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom", { exact: true }).fill("Site Atelier");
  await dialog
    .getByLabel("Client du site")
    .selectOption({ label: "Client Atelier · ATL-ELEC" });
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Site Atelier", exact: true }),
  ).toBeVisible();
  const csrf = (await (await page.request.get("/api/auth/me")).json()).csrf,
    sites = await (await page.request.get("/api/locations")).json(),
    site = sites.find((l: any) => l.name === "Site Atelier");
  async function createLocation(data: unknown) {
    const result = await page.request.post("/api/locations", {
      headers: { "x-csrf-token": csrf },
      data,
    });
    expect(result.status()).toBe(201);
    return result.json();
  }
  const building = await createLocation({
    name: "Bâtiment Atelier",
    kind: "BUILDING",
    parentId: site.id,
  });
  const panel = await createLocation({
    name: "Armoire générale",
    reference: "TGBT-42",
    description: "Distribution étage ouest",
    kind: "PANEL",
    parentId: building.id,
  });
  await page.reload();
  await page.getByRole("button", { name: "▦ Patrimoine", exact: true }).click();
  await page.getByLabel("Rechercher dans le patrimoine").fill("generale");
  await expect(page.locator(".tree-item")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: /Bâtiment Atelier/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "1 résultat" }),
  ).toBeVisible();
  await page.getByLabel("Type d’élément").selectOption("PANEL");
  await page.getByLabel("Rechercher dans le patrimoine").fill("TGBT-42 ouest");
  await expect(page.locator(".tree-item.search-match")).toHaveCount(1);
  await page.getByRole("button", { name: /Armoire générale/ }).click();
  await expect(
    page.getByRole("heading", { name: "Armoire générale", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Rechercher dans le patrimoine").fill("introuvable");
  await expect(
    page.getByText("Aucun élément correspondant. Modifiez votre recherche."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Effacer la recherche" }).click();
  await expect(page.getByLabel("Rechercher dans le patrimoine")).toHaveValue(
    "",
  );
  await page.getByLabel("Rechercher dans le patrimoine").fill("atelier");
  await page.screenshot({
    path: "artifacts/electroplan-patrimoine-recherche.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "▤ Documents", exact: true }).click();
  await page.getByRole("button", { name: "+ Nouveau document" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom du document").fill("Plan automatique Atelier");
  await dialog
    .getByLabel("Localisation", { exact: true })
    .selectOption(panel.id);
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await dialog.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(page.getByText("ATL-ELEC-00001", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Modifier la fiche" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveValue(
    "ATL-ELEC-00001",
  );
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "◇ Clients", exact: true }).click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Préfixe documentaire")).toHaveAttribute(
    "readonly",
    "",
  );
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.screenshot({
    path: "artifacts/electroplan-clients.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
