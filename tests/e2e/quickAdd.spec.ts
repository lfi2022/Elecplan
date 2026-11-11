import { test, expect } from "@playwright/test";
test("ajout depuis un bâtiment et recherche de localisation à trois caractères", async ({
  page,
}) => {
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
  const login = await page.request.post("/api/auth/login", {
    data: { email: "admin@example.test", password: "administrator-password" },
  });
  expect(login.ok()).toBe(true);
  const csrf = (await login.json()).csrf;
  async function post(url: string, data: unknown) {
    const result = await page.request.post("/api" + url, {
      headers: { "x-csrf-token": csrf },
      data,
    });
    expect(result.status(), await result.text()).toBe(201);
    return result.json();
  }
  const client = await post("/clients", { name: "Ajout rapide" }),
    site = await post("/locations", {
      name: "Site Ajout rapide",
      kind: "SITE",
      clientId: client.id,
    }),
    building = await post("/locations", {
      name: "Bâtiment Ajout rapide",
      kind: "BUILDING",
      parentId: site.id,
    }),
    floor = await post("/locations", {
      name: "Étage test",
      kind: "FLOOR",
      parentId: building.id,
    });
  const rooms = [];
  for (let i = 1; i <= 24; i++)
    rooms.push(
      await post("/locations", {
        name: `Local électrique ${i}`,
        reference: `RAPIDE-${i}`,
        kind: "ROOM",
        parentId: floor.id,
      }),
    );
  await page.goto("/");
  await page.getByRole("button", { name: "▦ Patrimoine", exact: true }).click();
  await page
    .getByLabel("Rechercher dans le patrimoine")
    .fill("Bâtiment Ajout rapide");
  await page.getByRole("button", { name: /Bâtiment Ajout rapide/ }).click();
  await page
    .getByRole("button", { name: "+ Ajouter un document ici", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Ajouter un document ici" });
  await expect(dialog.locator("input[name=locationId]")).toHaveValue(
    building.id,
  );
  await expect(dialog.locator(".location-picker-selection")).toContainText(
    "Site Ajout rapide / Bâtiment Ajout rapide",
  );
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await dialog.getByLabel("Nom du document").fill("Plan ajouté directement");
  await dialog.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan ajouté directement", exact: true }),
  ).toBeVisible();
  const stored = (
    await (
      await page.request.get(
        `/api/documents?q=Plan%20ajout%C3%A9%20directement`,
      )
    ).json()
  ).items[0];
  expect(stored.locationId).toBe(building.id);
  expect(stored.clientId).toBe(client.id);
  await page.getByRole("button", { name: "Modifier la fiche" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Changer la localisation" }).click();
  const input = dialog.getByRole("combobox", {
    name: "Rechercher une localisation",
  });
  await input.fill("lo");
  await expect(
    dialog.getByRole("listbox", { name: "Localisations trouvées" }),
  ).toHaveCount(0);
  await input.fill("electrique rapide");
  await expect(
    dialog
      .getByRole("listbox", { name: "Localisations trouvées" })
      .getByRole("option"),
  ).toHaveCount(20);
  await expect(dialog.getByRole("status")).toContainText("20 résultats sur 24");
  await input.fill("RAPIDE-24");
  await expect(
    dialog
      .getByRole("listbox", { name: "Localisations trouvées" })
      .getByRole("option"),
  ).toHaveCount(1);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(dialog.locator("input[name=locationId]")).toHaveValue(
    rooms[23].id,
  );
  await dialog.getByRole("button", { name: "Enregistrer la fiche" }).click();
  expect(
    (await (await page.request.get(`/api/documents/${stored.id}`)).json())
      .locationId,
  ).toBe(rooms[23].id);
  await page.getByRole("button", { name: "Modifier la fiche" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Changer la localisation" }).click();
  await dialog
    .getByRole("combobox", { name: "Rechercher une localisation" })
    .fill("introuvable");
  await expect(dialog.getByRole("status")).toContainText(
    "Aucune localisation trouvée",
  );
  await expect(dialog.locator("input[name=locationId]")).toHaveValue("");
  await page.screenshot({
    path: "artifacts/electroplan-recherche-localisation.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
});
