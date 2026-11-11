import { test, expect } from "@playwright/test";
import { chooseLocation } from "../locationPicker";
test("installation, patrimoine, import, consultation, révision, filtres et thème mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bienvenue dans ElectroPlan" }),
  ).toBeVisible();
  await page.getByLabel("Nom complet").fill("Florian Admin");
  await page
    .getByLabel("Jeton d’installation")
    .fill("e2e-setup-token-of-at-least-24-characters");
  await page.getByLabel("Adresse e-mail").fill("admin@example.test");
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("administrator-password");
  await page.getByRole("button", { name: "Créer mon installation" }).click();
  await expect(
    page.getByRole("button", { name: "Se connecter" }),
  ).toBeVisible();
  await page.getByLabel("Adresse e-mail").fill("admin@example.test");
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("administrator-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(
    page.getByRole("heading", { name: "Vue d’ensemble", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "▦ Patrimoine", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Ajouter une localisation" })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom", { exact: true }).fill("Site Bruxelles");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Site Bruxelles", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "QR code", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "QR code de Site Bruxelles" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "▤ Documents", exact: true }).click();
  await page.getByRole("button", { name: "+ Nouveau document" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom du document").fill("Plan de distribution");
  await dialog.getByLabel("Référence", { exact: true }).fill("ELEC-001");
  await chooseLocation(dialog, "Site Bruxelles");
  await dialog
    .getByLabel("Tags (séparés par des virgules)")
    .fill("test, distribution");
  await dialog.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan de distribution", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Révision", { exact: true }).fill("A");
  await page.getByLabel("Fichier (50 Mo maximum)").setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nxoAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Importer une révision" }).click();
  await expect(
    page.getByRole("button", { name: "Prévisualiser", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prévisualiser", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Plan de distribution" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Fermer le lecteur", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Télécharger la version en vigueur" })
    .click();
  expect((await downloadPromise).suggestedFilename()).toBe("plan.png");
  await page.getByRole("button", { name: "Modifier la fiche" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Statut", { exact: true }).selectOption("En vigueur");
  await dialog.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await page.getByRole("button", { name: "← Retour aux documents" }).click();
  await page
    .getByRole("textbox", { name: "Rechercher des documents" })
    .fill("ELEC-001");
  await expect(
    page.getByRole("cell", { name: "Plan de distribution ELEC-001" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Changer de thème" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "artifacts/electroplan-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", {
      name: "Bibliothèque documentaire",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/electroplan-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
