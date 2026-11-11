-- FTS5 indexes extracted PDF text locally, including accents and prefix search.
CREATE VIRTUAL TABLE "VersionSearch" USING fts5("versionId" UNINDEXED, "documentId" UNINDEXED, "text", tokenize = 'unicode61 remove_diacritics 2');
INSERT INTO "VersionSearch" ("versionId", "documentId", "text") SELECT "id", "documentId", "text" FROM "Version";
CREATE TRIGGER version_search_insert AFTER INSERT ON "Version" BEGIN
  INSERT INTO "VersionSearch" ("versionId", "documentId", "text") VALUES (new."id", new."documentId", new."text");
END;
CREATE TRIGGER version_search_delete AFTER DELETE ON "Version" BEGIN
  DELETE FROM "VersionSearch" WHERE "versionId" = old."id";
END;
CREATE TRIGGER version_search_update AFTER UPDATE OF "text" ON "Version" BEGIN
  DELETE FROM "VersionSearch" WHERE "versionId" = old."id";
  INSERT INTO "VersionSearch" ("versionId", "documentId", "text") VALUES (new."id", new."documentId", new."text");
END;
