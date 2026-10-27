import { describe, it, expect } from 'vitest'
import { TFile, TFolder } from 'obsidian'
import { buildEmbedBlock } from '../src/insert-view'
import { parseEmbedBlock } from '../src/database-embed'

const dbIn = (folder: string): TFile => Object.assign(new TFile(), { parent: Object.assign(new TFolder(), { path: folder }) })

/** The code block's body, as the embed processor receives it. */
const body = (block: string) => block.split('\n').slice(1, -1).join('\n')

describe('buildEmbedBlock', () => {
	it('shows every view as tabs when no type is chosen', () => {
		const block = buildEmbedBlock(dbIn('Projects/Tasks'), undefined, 'nbtest')
		expect(block).toBe('```nb-database\nid: nbtest\npath: Projects/Tasks\n```')
		expect(parseEmbedBlock(body(block))).toEqual({ folderPath: 'Projects/Tasks', embedId: 'nbtest', forcedType: undefined })
	})

	it.each(['table', 'list', 'board', 'gallery', 'calendar', 'timeline', 'chart'] as const)('pins the %s view', type => {
		const block = buildEmbedBlock(dbIn('Projects'), type, 'nbtest')
		expect(block).toBe(`\`\`\`nb-database\nid: nbtest\npath: Projects\ntype: ${type}\n\`\`\``)
		expect(parseEmbedBlock(body(block)).forcedType).toBe(type)
	})

	it('comes with its own id, so the embed never has to write one', () => {
		const a = parseEmbedBlock(body(buildEmbedBlock(dbIn('Projects'))))
		const b = parseEmbedBlock(body(buildEmbedBlock(dbIn('Projects'))))
		expect(a.embedId).toMatch(/^nb[a-z0-9]+$/)
		expect(a.embedId).not.toBe(b.embedId)
	})

	it('omits the path of a database at the vault root', () => {
		expect(buildEmbedBlock(dbIn(''), 'board', 'nbtest')).toBe('```nb-database\nid: nbtest\ntype: board\n```')
		expect(buildEmbedBlock(dbIn('/'), undefined, 'nbtest')).toBe('```nb-database\nid: nbtest\n```')
		expect(parseEmbedBlock('type: board').folderPath).toBe('')
	})

	it('keeps folder names with spaces and accents', () => {
		const block = buildEmbedBlock(dbIn('Área de trabalho/Meus projetos'), 'gallery')
		expect(parseEmbedBlock(body(block)).folderPath).toBe('Área de trabalho/Meus projetos')
	})
})
