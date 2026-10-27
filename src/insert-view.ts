import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, FuzzySuggestModal, TFile } from 'obsidian'
import { t } from './i18n'
import { DatabasePickerModal } from './database-picker-modal'
import { newEmbedId } from './database-embed'
import type { DatabaseManager } from './database-manager'
import type { ViewConfig } from './types'

type ViewType = ViewConfig['type']

/** View types an inline view can be pinned to, in the order they are offered. */
const VIEW_TYPES: ViewType[] = ['table', 'list', 'board', 'gallery', 'calendar', 'timeline', 'chart']

const VIEW_LABELS: Record<ViewType, () => string> = {
	table: () => t('view_table'),
	list: () => t('view_list'),
	board: () => t('view_board'),
	gallery: () => t('view_gallery'),
	calendar: () => t('view_calendar'),
	timeline: () => t('view_timeline'),
	chart: () => t('view_chart'),
}

/**
 * The ```nb-database block showing the database at `dbFile`: every view as
 * tabs, or a single view pinned to `type`. It carries its `id` from the
 * start: letting the embed add it on first render races with the embed
 * saving its views, which can drop the id and lose the view settings.
 */
export function buildEmbedBlock(dbFile: Pick<TFile, 'parent'>, type?: ViewType, id = newEmbedId()): string {
	const folder = dbFile.parent?.path ?? ''
	const lines = ['```nb-database', `id: ${id}`]
	if (folder && folder !== '/') lines.push(`path: ${folder}`)
	if (type) lines.push(`type: ${type}`)
	lines.push('```')
	return lines.join('\n')
}

/**
 * Inserts `block` at the cursor, replacing the line when it is empty (else
 * right below it), with a blank line between it and any neighbouring text.
 */
function insertBlock(editor: Editor, block: string) {
	const { line } = editor.getCursor()
	const text = editor.getLine(line)
	const replace = !text.trim()
	const prev = replace ? (line > 0 ? editor.getLine(line - 1) : '') : text
	const next = line < editor.lastLine() ? editor.getLine(line + 1) : ''
	const content = (prev.trim() ? '\n' : '') + block + (next.trim() ? '\n' : '')
	if (replace) editor.replaceRange(content, { line, ch: 0 }, { line, ch: text.length })
	else editor.replaceRange('\n' + content, { line, ch: text.length })
	editor.focus()
}

interface ViewChoice {
	type?: ViewType
	label: string
}

/** Asks how the database should be shown: every view as tabs, or one view type. */
class ViewTypePickerModal extends FuzzySuggestModal<ViewChoice> {
	constructor(app: App, private onChoose: (type?: ViewType) => void) {
		super(app)
		this.setPlaceholder(t('insert_view_placeholder'))
	}

	getItems(): ViewChoice[] {
		return [{ label: t('insert_view_all') }, ...VIEW_TYPES.map(type => ({ type, label: VIEW_LABELS[type]() }))]
	}

	getItemText(choice: ViewChoice): string {
		return choice.label
	}

	onChooseItem(choice: ViewChoice): void {
		this.onChoose(choice.type)
	}
}

/** Picks the view type for `dbFile`, then inserts its inline view at the cursor. */
function chooseViewAndInsert(app: App, editor: Editor, dbFile: TFile) {
	new ViewTypePickerModal(app, type => insertBlock(editor, buildEmbedBlock(dbFile, type))).open()
}

/** "Insert database view" command: pick a database, then how to show it. */
export function insertDatabaseView(app: App, manager: DatabaseManager, editor: Editor) {
	const databases = manager.getAllDatabases().sort((a, b) => (a.parent?.path ?? '').localeCompare(b.parent?.path ?? ''))
	if (databases.length === 0) return false
	new DatabasePickerModal(app, databases, dbFile => chooseViewAndInsert(app, editor, dbFile)).open()
	return true
}

/** Notion-like `/database` menu: lists the databases, filtered by what follows the trigger. */
export class DatabaseViewSuggest extends EditorSuggest<TFile> {
	constructor(app: App, private manager: DatabaseManager) {
		super(app)
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch)
		// `/data…`, `/db` or `/view…`, optionally followed by a filter: `/database proj`
		const match = before.match(/(?:^|\s)\/(?:data\w*|db|view\w*)(?:\s+(.*))?$/i)
		if (!match || match.index === undefined) return null
		const start = match.index + match[0].indexOf('/')
		return { start: { line: cursor.line, ch: start }, end: cursor, query: match[1] ?? '' }
	}

	getSuggestions(context: EditorSuggestContext): TFile[] {
		const query = context.query.trim().toLowerCase()
		return this.manager
			.getAllDatabases()
			.filter(f => !query || (f.parent?.path ?? '').toLowerCase().includes(query))
			.sort((a, b) => (a.parent?.path ?? '').localeCompare(b.parent?.path ?? ''))
	}

	renderSuggestion(dbFile: TFile, el: HTMLElement) {
		const isRoot = !dbFile.parent?.path || dbFile.parent.path === '/'
		el.createDiv({ text: isRoot ? t('picker_root') : (dbFile.parent?.name ?? '/'), cls: 'nb-picker-title' })
		if (!isRoot) el.createEl('small', { text: dbFile.parent?.path ?? '', cls: 'nb-picker-path' })
	}

	selectSuggestion(dbFile: TFile) {
		const context = this.context
		if (!context) return
		context.editor.replaceRange('', context.start, context.end)
		chooseViewAndInsert(this.app, context.editor, dbFile)
	}
}
