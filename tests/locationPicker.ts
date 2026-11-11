import type { Locator } from "@playwright/test";
export async function chooseLocation(
  dialog: Locator,
  query: string,
  id?: string,
) {
  const change = dialog.getByRole("button", {
    name: "Changer la localisation",
    exact: true,
  });
  if (await change.count()) await change.click();
  await dialog
    .getByRole("combobox", { name: "Rechercher une localisation" })
    .fill(query);
  if (id)
    await dialog.locator(`[role=option][data-location-id="${id}"]`).click();
  else
    await dialog
      .getByRole("listbox", { name: "Localisations trouvées" })
      .getByRole("option")
      .filter({ hasText: query })
      .first()
      .click();
}
