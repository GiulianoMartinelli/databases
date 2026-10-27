import { App, Keymap, TFile, normalizePath } from 'obsidian'

/**
 * The note a relation / rollup value refers to: a note named `name` in the
 * folder of the database at `databasePath`, or the closest note with that
 * name (rows may live in subfolders).
 */
export function findRelatedNote(app: App, databasePath: string | undefined, name: string): TFile | null {
	const folder = databasePath ? app.vault.getFileByPath(databasePath)?.parent?.path : undefined
	if (folder !== undefined) {
		const direct = app.vault.getFileByPath(normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`))
		if (direct) return direct
	}
	return app.metadataCache.getFirstLinkpathDest(name, databasePath ?? '')
}

/** Opens a related note like an internal link: Ctrl/Cmd-click opens it in a new tab. */
export function openRelatedNote(app: App, file: TFile, event: MouseEvent): void {
	void app.workspace.getLeaf(Keymap.isModEvent(event)).openFile(file)
}
