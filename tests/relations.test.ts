import { describe, it, expect, beforeEach } from 'vitest'
import { TFile, TFolder } from 'obsidian'
import { DatabaseManager } from '../src/database-manager'
import type { ColumnSchema, NoteRow } from '../src/types'

// In-memory vault: notes with frontmatter, organized in folders.
type Frontmatter = Record<string, unknown>

function createVault(notes: Record<string, Frontmatter>) {
	const files = new Map<string, TFile>()
	const folders = new Map<string, TFolder>()
	const data = new Map<string, Frontmatter>()

	const folderAt = (path: string): TFolder => {
		let folder = folders.get(path)
		if (!folder) {
			folder = Object.assign(new TFolder(), { path, children: [] })
			folders.set(path, folder)
		}
		return folder
	}
	const place = (file: TFile, path: string) => {
		const parts = path.split('/')
		const name = parts.pop()!
		Object.assign(file, { path, name, basename: name.replace(/\.md$/, ''), parent: folderAt(parts.join('/')) })
		;(file as unknown as { parent: TFolder }).parent.children.push(file)
	}

	for (const [path, fm] of Object.entries(notes)) {
		const file = new TFile()
		place(file, path)
		files.set(path, file)
		data.set(path, structuredClone(fm))
	}

	const app = {
		vault: {
			getFileByPath: (p: string) => files.get(p) ?? null,
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
			getMarkdownFiles: () => [...files.values()],
			getRoot: () => folderAt(''),
		},
		metadataCache: {
			getFileCache: (f: TFile) => ({ frontmatter: data.get(f.path) }),
			getFirstLinkpathDest: () => null,
		},
		fileManager: {
			processFrontMatter: async (f: TFile, fn: (fm: Frontmatter) => void) => {
				const fm = data.get(f.path) ?? {}
				fn(fm)
				data.set(f.path, fm)
			},
		},
	}

	/** Renames/moves a note like Obsidian does; returns its old path. */
	const rename = (path: string, newPath: string): { file: TFile; oldPath: string } => {
		const file = files.get(path)!
		const parent = (file as unknown as { parent: TFolder }).parent
		parent.children = parent.children.filter(c => c !== file)
		files.delete(path)
		place(file, newPath)
		files.set(newPath, file)
		data.set(newPath, data.get(path)!)
		data.delete(path)
		return { file, oldPath: path }
	}

	return { app, fm: (path: string) => data.get(path)!, rename, file: (path: string) => files.get(path)! }
}

const relation = (id: string, target: string): ColumnSchema => ({ id, name: id, type: 'relation', visible: true, refDatabasePath: target })

describe('relations after renames', () => {
	let vault: ReturnType<typeof createVault>
	let manager: DatabaseManager

	beforeEach(() => {
		vault = createVault({
			'DB1/_database.md': { 'notion-bases': true, schema: [{ id: 'valor', name: 'valor', type: 'number', visible: true }] },
			'DB1/Teste.md': { valor: 1 },
			'DB1/Outro.md': { valor: 2 },
			'DB2/_database.md': { 'notion-bases': true, schema: [relation('database-1', 'DB1/_database.md')] },
			'DB2/Ponto.md': { 'database-1': ['Teste', 'Outro'] },
			'DB2/Linha.md': { 'database-1': 'Teste' },
			'DB2/Sem.md': { 'database-1': ['Outro'] },
		})
		manager = new DatabaseManager(vault.app as never, '_database.md')
	})

	it('renaming a related note updates the relation cells pointing at it', async () => {
		const { file, oldPath } = vault.rename('DB1/Teste.md', 'DB1/Teste 2.md')
		await manager.handleRename(file, oldPath)
		expect(vault.fm('DB2/Ponto.md')['database-1']).toEqual(['Teste 2', 'Outro'])
		expect(vault.fm('DB2/Linha.md')['database-1']).toBe('Teste 2')
		expect(vault.fm('DB2/Sem.md')['database-1']).toEqual(['Outro'])
	})

	it('only rewrites relations whose target is the renamed note\'s database', async () => {
		const other = createVault({
			'DB1/_database.md': { 'notion-bases': true, schema: [] },
			'DB1/Teste.md': {},
			'DB3/_database.md': { 'notion-bases': true, schema: [] },
			'DB3/Teste.md': {},
			'DB2/_database.md': { 'notion-bases': true, schema: [relation('r1', 'DB1/_database.md'), relation('r3', 'DB3/_database.md')] },
			'DB2/Ponto.md': { r1: ['Teste'], r3: ['Teste'] },
		})
		const m = new DatabaseManager(other.app as never, '_database.md')
		const { file, oldPath } = other.rename('DB3/Teste.md', 'DB3/Novo.md')
		await m.handleRename(file, oldPath)
		expect(other.fm('DB2/Ponto.md')).toEqual({ r1: ['Teste'], r3: ['Novo'] })
	})

	it('moving a note without changing its name leaves relations alone', async () => {
		const { file, oldPath } = vault.rename('DB1/Teste.md', 'DB1/sub/Teste.md')
		await manager.handleRename(file, oldPath)
		expect(vault.fm('DB2/Ponto.md')['database-1']).toEqual(['Teste', 'Outro'])
	})

	it('moving a database updates the columns that reference its path', async () => {
		const { file, oldPath } = vault.rename('DB1/_database.md', 'Renamed/_database.md')
		await manager.handleRename(file, oldPath)
		const schema = vault.fm('DB2/_database.md').schema as ColumnSchema[]
		expect(schema[0].refDatabasePath).toBe('Renamed/_database.md')
	})
})

describe('rollup links', () => {
	const vault = createVault({
		'DB1/_database.md': {
			'notion-bases': true,
			schema: [
				{ id: 'valor', name: 'valor', type: 'number', visible: true },
				relation('tags', 'Tags/_database.md'),
			],
		},
		'DB1/Teste.md': { valor: 1, tags: ['A'] },
		'DB1/Outro.md': { valor: 2, tags: ['B', 'C'] },
		'Tags/_database.md': { 'notion-bases': true, schema: [] },
	})
	const manager = new DatabaseManager(vault.app as never, '_database.md')
	const rollup = (id: string, target: string, fn: ColumnSchema['rollupFunction']): ColumnSchema => ({
		id, name: id, type: 'rollup', visible: true, rollupRelationColumnId: 'rel', rollupTargetColumnId: target, rollupFunction: fn,
	})
	const schema: ColumnSchema[] = [
		relation('rel', 'DB1/_database.md'),
		rollup('titles', '_title', 'list'),
		rollup('tagList', 'tags', 'list'),
		rollup('total', 'valor', 'sum'),
	]
	const row = { _file: new TFile(), _title: 'Ponto', rel: ['Teste', 'Outro'] } as NoteRow
	const [resolved] = manager.resolveRollupsForRows([row], schema)

	it('keeps the value of every rollup as before', () => {
		expect(resolved.titles).toBe('Outro, Teste')
		expect(resolved.total).toBe(3)
	})

	it('lists the related pages of a list rollup over titles', () => {
		expect(resolved._rollupLinks?.titles).toEqual([
			{ name: 'Outro', databasePath: 'DB1/_database.md' },
			{ name: 'Teste', databasePath: 'DB1/_database.md' },
		])
	})

	it('lists the pages of a list rollup over a relation of the related database', () => {
		expect(resolved._rollupLinks?.tagList?.map(p => p.name)).toEqual(['B', 'C', 'A'])
		expect(resolved._rollupLinks?.tagList?.[0].databasePath).toBe('Tags/_database.md')
	})

	it('does not link non-page rollups', () => {
		expect(resolved._rollupLinks?.total).toBeUndefined()
	})
})
