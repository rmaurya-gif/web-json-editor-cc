import { useEffect, useState } from 'react'
import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/components/prism-json'
import 'prismjs/themes/prism.css'
import * as prettier from 'prettier/standalone'
import * as parserBabel from 'prettier/plugins/babel'
import * as prettierEstree from 'prettier/plugins/estree'
import './App.css'

interface JsonError {
  message: string
  line: number
  column: number
}

type ViewMode = 'text' | 'tree'

type DiffType = 'same' | 'added' | 'removed' | 'modified'

interface DiffNode {
  key: string
  value: unknown
  type: 'object' | 'array' | 'primitive'
  diffType: DiffType
  children?: DiffNode[]
  oldValue?: unknown
}

interface ComparisonResult {
  leftTree: DiffNode[] | null
  rightTree: DiffNode[] | null
  hasDifferences: boolean
}

function App() {
  const [leftJson, setLeftJson] = useState('')
  const [rightJson, setRightJson] = useState('')
  const [leftTitle, setLeftTitle] = useState('Input JSON 1')
  const [rightTitle, setRightTitle] = useState('Input JSON 2')
  const [leftError, setLeftError] = useState<JsonError | null>(null)
  const [rightError, setRightError] = useState<JsonError | null>(null)
  const [leftViewMode, setLeftViewMode] = useState<ViewMode>('text')
  const [rightViewMode, setRightViewMode] = useState<ViewMode>('text')
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null)
  const [compareEnabled, setCompareEnabled] = useState(false)

  const highlightJson = (code: string) => {
    if (!code) return ''
    return Prism.highlight(code, Prism.languages.json, 'json')
  }

  const validateJson = (json: string): JsonError | null => {
    if (!json.trim()) return null

    try {
      JSON.parse(json)
      return null
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid JSON'
      const match = errorMessage.match(/at position (\d+)/) ||
                   errorMessage.match(/at line (\d+) column (\d+)/)

      if (match) {
        if (match[2]) {
          // Line and column format
          return {
            message: errorMessage,
            line: parseInt(match[1]),
            column: parseInt(match[2])
          }
        } else {
          // Position format - convert to line/column
          const position = parseInt(match[1])
          const lines = json.substring(0, position).split('\n')
          const line = lines.length
          const column = lines[lines.length - 1].length + 1

          return {
            message: errorMessage,
            line,
            column
          }
        }
      }

      return {
        message: errorMessage,
        line: 1,
        column: 1
      }
    }
  }

  const handleLeftJsonChange = (code: string) => {
    setLeftJson(code)
    setLeftError(validateJson(code))
  }

  const handleRightJsonChange = (code: string) => {
    setRightJson(code)
    setRightError(validateJson(code))
  }

  const formatJson = async (json: string): Promise<string> => {
    try {
      const formatted = await prettier.format(json, {
        parser: 'json',
        plugins: [parserBabel, prettierEstree],
        tabWidth: 2,
        printWidth: 80,
      })
      return formatted
    } catch {
      throw new Error('Invalid JSON')
    }
  }

  const handleFormatLeft = async () => {
    if (!leftJson.trim()) return
    try {
      const formatted = await formatJson(leftJson)
      setLeftJson(formatted)
      setLeftError(validateJson(formatted))
    } catch {
      setLeftError({ message: 'Invalid JSON', line: 1, column: 1 })
    }
  }

  const handleFormatRight = async () => {
    if (!rightJson.trim()) return
    try {
      const formatted = await formatJson(rightJson)
      setRightJson(formatted)
      setRightError(validateJson(formatted))
    } catch {
      setRightError({ message: 'Invalid JSON', line: 1, column: 1 })
    }
  }

  const handleClearLeft = () => {
    setLeftJson('')
    setLeftError(null)
  }

  const handleClearRight = () => {
    setRightJson('')
    setRightError(null)
  }

  const copyLeftToRight = () => {
    setRightJson(leftJson)
  }

  const copyRightToLeft = () => {
    setLeftJson(rightJson)
  }

  const downloadJson = (json: string, filename: string) => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleDownloadLeft = () => {
    downloadJson(leftJson, leftTitle.replace(/\s+/g, '_'))
  }

  const handleDownloadRight = () => {
    downloadJson(rightJson, rightTitle.replace(/\s+/g, '_'))
  }

  const showErrorLocation = (editorId: 'left' | 'right', line: number, column: number) => {
    const textarea = editorId === 'left'
      ? document.getElementById('left-editor') as HTMLTextAreaElement
      : document.getElementById('right-editor') as HTMLTextAreaElement

    if (!textarea) return

    const lines = (editorId === 'left' ? leftJson : rightJson).split('\n')
    let position = 0
    for (let i = 0; i < line - 1 && i < lines.length; i++) {
      position += lines[i].length + 1 // +1 for newline
    }
    position += column - 1

    textarea.focus()
    textarea.setSelectionRange(position, position + 1)

    // Scroll to the error position
    const lineHeight = 20 // approximate line height
    textarea.scrollTop = (line - 1) * lineHeight - textarea.clientHeight / 2
  }

  const getValueType = (value: unknown): 'object' | 'array' | 'primitive' => {
    if (Array.isArray(value)) return 'array'
    if (value !== null && typeof value === 'object') return 'object'
    return 'primitive'
  }

  const compareValues = (left: unknown, right: unknown, key: string): { leftNode: DiffNode | null; rightNode: DiffNode | null } => {
    const leftType = getValueType(left)
    const rightType = getValueType(right)

    // Different types - show as modified in both
    if (leftType !== rightType) {
      return {
        leftNode: {
          key,
          value: left,
          type: leftType,
          diffType: 'modified',
          children: leftType !== 'primitive' ? buildTreeChildren(left) : undefined
        },
        rightNode: {
          key,
          value: right,
          type: rightType,
          diffType: 'modified',
          oldValue: left,
          children: rightType !== 'primitive' ? buildTreeChildren(right) : undefined
        }
      }
    }

    // Both are primitives
    if (leftType === 'primitive') {
      const isSame = left === right
      return {
        leftNode: { key, value: left, type: 'primitive', diffType: isSame ? 'same' : 'modified' },
        rightNode: { key, value: right, type: 'primitive', diffType: isSame ? 'same' : 'modified', oldValue: isSame ? undefined : left }
      }
    }

    // Both are arrays
    if (leftType === 'array' && rightType === 'array') {
      const leftArr = left as unknown[]
      const rightArr = right as unknown[]
      const leftChildren: DiffNode[] = []
      const rightChildren: DiffNode[] = []

      // Process items that exist in both arrays up to min length
      const minLen = Math.min(leftArr.length, rightArr.length)
      for (let i = 0; i < minLen; i++) {
        const { leftNode, rightNode } = compareValues(leftArr[i], rightArr[i], `[${i}]`)
        if (leftNode) leftChildren.push(leftNode)
        if (rightNode) rightChildren.push(rightNode)
      }

      // Extra items in left array (removed from right) - show only in left as red
      for (let i = minLen; i < leftArr.length; i++) {
        leftChildren.push({
          key: `[${i}]`,
          value: leftArr[i],
          type: getValueType(leftArr[i]),
          diffType: 'removed',
          children: getValueType(leftArr[i]) !== 'primitive' ? buildTreeChildren(leftArr[i]) : undefined
        })
      }

      // Extra items in right array (added in right) - show only in right as green
      for (let i = minLen; i < rightArr.length; i++) {
        rightChildren.push({
          key: `[${i}]`,
          value: rightArr[i],
          type: getValueType(rightArr[i]),
          diffType: 'added',
          children: getValueType(rightArr[i]) !== 'primitive' ? buildTreeChildren(rightArr[i]) : undefined
        })
      }

      const hasDiff = leftChildren.some(c => c.diffType !== 'same') || rightChildren.some(c => c.diffType !== 'same')
      return {
        leftNode: { key, value: left, type: 'array', diffType: hasDiff ? 'modified' : 'same', children: leftChildren },
        rightNode: { key, value: right, type: 'array', diffType: hasDiff ? 'modified' : 'same', children: rightChildren }
      }
    }

    // Both are objects
    if (leftType === 'object' && rightType === 'object') {
      const leftObj = left as Record<string, unknown>
      const rightObj = right as Record<string, unknown>
      const leftKeys = Object.keys(leftObj)
      const rightKeys = Object.keys(rightObj)
      const leftChildren: DiffNode[] = []
      const rightChildren: DiffNode[] = []

      // Keys only in left (removed from right) - show only in left as red
      leftKeys.forEach(k => {
        if (!(k in rightObj)) {
          leftChildren.push({
            key: k,
            value: leftObj[k],
            type: getValueType(leftObj[k]),
            diffType: 'removed',
            children: getValueType(leftObj[k]) !== 'primitive' ? buildTreeChildren(leftObj[k]) : undefined
          })
        } else {
          // Key exists in both - compare values
          const { leftNode, rightNode } = compareValues(leftObj[k], rightObj[k], k)
          if (leftNode) leftChildren.push(leftNode)
          if (rightNode) rightChildren.push(rightNode)
        }
      })

      // Keys only in right (added in right) - show only in right as green
      rightKeys.forEach(k => {
        if (!(k in leftObj)) {
          rightChildren.push({
            key: k,
            value: rightObj[k],
            type: getValueType(rightObj[k]),
            diffType: 'added',
            children: getValueType(rightObj[k]) !== 'primitive' ? buildTreeChildren(rightObj[k]) : undefined
          })
        }
      })

      const hasDiff = leftChildren.some(c => c.diffType !== 'same') || rightChildren.some(c => c.diffType !== 'same')
      return {
        leftNode: { key, value: left, type: 'object', diffType: hasDiff ? 'modified' : 'same', children: leftChildren },
        rightNode: { key, value: right, type: 'object', diffType: hasDiff ? 'modified' : 'same', children: rightChildren }
      }
    }

    // Fallback
    return {
      leftNode: { key, value: left, type: 'primitive', diffType: 'same' },
      rightNode: { key, value: right, type: 'primitive', diffType: 'same' }
    }
  }

  const buildTreeChildren = (value: unknown): DiffNode[] => {
    const type = getValueType(value)
    if (type === 'array') {
      return (value as unknown[]).map((item, i) => ({
        key: `[${i}]`,
        value: item,
        type: getValueType(item),
        diffType: 'same' as DiffType,
        children: getValueType(item) !== 'primitive' ? buildTreeChildren(item) : undefined
      }))
    }
    if (type === 'object' && value !== null) {
      return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
        key: k,
        value: v,
        type: getValueType(v),
        diffType: 'same' as DiffType,
        children: getValueType(v) !== 'primitive' ? buildTreeChildren(v) : undefined
      }))
    }
    return []
  }

  const compareJsons = () => {
    if (leftError || rightError) {
      setComparisonResult(null)
      return
    }

    if (!leftJson.trim() || !rightJson.trim()) {
      setComparisonResult(null)
      return
    }

    try {
      const leftParsed = JSON.parse(leftJson)
      const rightParsed = JSON.parse(rightJson)

      const { leftNode, rightNode } = compareValues(leftParsed, rightParsed, 'root')

      setComparisonResult({
        leftTree: leftNode ? [leftNode] : null,
        rightTree: rightNode ? [rightNode] : null,
        hasDifferences: (leftNode?.diffType !== 'same') || (rightNode?.diffType !== 'same')
      })
    } catch {
      setComparisonResult(null)
    }
  }

  useEffect(() => {
    if (!compareEnabled) {
      setComparisonResult(null)
      return
    }
    compareJsons()
  }, [compareEnabled, leftJson, rightJson, leftError, rightError])

  const formatPrimitiveValue = (value: unknown): string => {
    if (value === null) return 'null'
    if (typeof value === 'string') return `"${value}"`
    return String(value)
  }

  const TreeView = ({ nodes, depth = 0, path = '' }: { nodes: DiffNode[]; depth?: number; path?: string }) => {
    return (
      <div className="font-mono text-sm">
        {nodes.map((node, index) => {
          const hasChildren = node.children && node.children.length > 0

          return (
            <div key={`${node.key}-${index}`}>
              <div 
                className={`py-0.5 px-1 hover:bg-gray-50`}
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
              >
                <span className="inline-block w-4 mr-1"></span>
                <span className="text-blue-600">{node.key}</span>
                <span className="text-gray-500">: </span>
                {node.type === 'primitive' && (
                  <>
                    <span className={`${
                      node.diffType === 'added' ? 'bg-green-100 text-green-800' :
                      node.diffType === 'removed' ? 'bg-red-100 text-red-800' :
                      node.diffType === 'modified' ? 'bg-yellow-100 text-yellow-800' :
                      typeof node.value === 'string' ? 'text-green-600' :
                      typeof node.value === 'number' ? 'text-orange-600' :
                      typeof node.value === 'boolean' ? 'text-purple-600' :
                      'text-gray-600'
                    }`}>
                      {formatPrimitiveValue(node.value)}
                    </span>
                    {node.oldValue !== undefined && (
                      <span className="text-gray-400 text-xs ml-2">
                        (was: {formatPrimitiveValue(node.oldValue)})
                      </span>
                    )}
                  </>
                )}
                {node.type === 'array' && (
                  <span className="text-gray-500">
                    [
                  </span>
                )}
                {node.type === 'object' && (
                  <span className="text-gray-500">
                    {'{'}
                  </span>
                )}
              </div>
              {hasChildren && (
                <>
                  <TreeView nodes={node.children!} depth={depth + 1} path={`${path}.${node.key}`} />
                  <div 
                    className="text-gray-500"
                    style={{ paddingLeft: `${depth * 16 + 4}px` }}
                  >
                    <span className="inline-block w-4 mr-1"></span>
                    {node.type === 'array' ? ']' : '}'}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans">
      {/* Top Bar */}
      <header className="bg-blue-600 text-white p-4 shadow-md">
        <h1 className="text-xl font-bold">JSON Editor</h1>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left JSON Editor Column */}
        <div className="flex flex-col flex-1 border-r border-gray-300 bg-white">
          <div className="bg-gray-200 border-b border-gray-300">
            {/* First row: Title and actions */}
            <div className="flex items-center justify-between p-2">
              <input
                type="text"
                value={leftTitle}
                onChange={(e) => setLeftTitle(e.target.value)}
                className="font-semibold text-gray-700 text-sm bg-transparent border-none outline-none focus:bg-white focus:px-1 rounded"
              />
              <div className="flex gap-2">
                <button 
                  onClick={handleDownloadLeft}
                  className="px-2 py-1 text-xs bg-white border border-gray-400 rounded hover:bg-gray-50 flex items-center gap-1"
                  title="Download JSON"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button 
                  onClick={handleFormatLeft}
                  className="px-2 py-1 text-xs bg-white border border-gray-400 rounded hover:bg-gray-50"
                >
                  Format
                </button>
                <button 
                  onClick={handleClearLeft}
                  className="px-2 py-1 text-xs bg-white border border-gray-400 rounded hover:bg-gray-50"
                >
                  Clear
                </button>
              </div>
            </div>
            {/* Second row: View mode toggle */}
            <div className="flex items-center gap-1 px-2 pb-2">
              <button
                onClick={() => setLeftViewMode('text')}
                className={`px-3 py-0.5 text-xs rounded ${leftViewMode === 'text' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border border-gray-400'}`}
              >
                Text
              </button>
              <button
                onClick={() => setLeftViewMode('tree')}
                className={`px-3 py-0.5 text-xs rounded ${leftViewMode === 'tree' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border border-gray-400'}`}
              >
                Tree
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {leftViewMode === 'text' ? (
              <div className="editor-wrapper">
                <Editor
                  value={leftJson}
                  onValueChange={handleLeftJsonChange}
                  highlight={highlightJson}
                  padding={16}
                  textareaId="left-editor"
                  className="font-mono text-sm min-h-full code-editor"
                  textareaClassName="editor-textarea"
                  placeholder="Paste your JSON here..."
                />
              </div>
            ) : (
              <div className="p-4">
                {comparisonResult?.leftTree ? (
                  <TreeView nodes={comparisonResult.leftTree} />
                ) : leftJson.trim() ? (
                  <TreeView nodes={buildTreeChildren(JSON.parse(leftJson))} />
                ) : (
                  <span className="text-gray-400">Paste JSON to view tree</span>
                )}
              </div>
            )}
          </div>
          {leftError && (
            <div className="flex items-center justify-between px-3 py-2 text-xs text-white bg-red-500 border-t border-red-600">
              <span className="truncate flex-1">
                Line {leftError.line}, Column {leftError.column}: {leftError.message}
              </span>
              <button
                onClick={() => showErrorLocation('left', leftError.line, leftError.column)}
                className="ml-2 px-2 py-1 bg-white text-red-600 rounded font-medium hover:bg-red-50 flex-shrink-0"
              >
                Show me
              </button>
            </div>
          )}
        </div>

        {/* Center Action Column */}
        <div className="flex flex-col items-center justify-center w-24 bg-gray-50 border-x border-gray-300 gap-2 p-2">
          <span className="text-xs text-gray-500 font-medium mb-2">Copy</span>
          <button 
            onClick={copyLeftToRight}
            className="p-2 bg-white border border-gray-400 rounded hover:bg-blue-50 shadow-sm flex items-center justify-center"
            title="Copy from left to right"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/>
              <path d="m12 5 7 7-7 7"/>
            </svg>
          </button>
          <button 
            onClick={copyRightToLeft}
            className="p-2 bg-white border border-gray-400 rounded hover:bg-blue-50 shadow-sm flex items-center justify-center"
            title="Copy from right to left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/>
              <path d="m12 19-7-7 7-7"/>
            </svg>
          </button>
          <div className="w-full h-px bg-gray-300 my-2"></div>
          <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) => setCompareEnabled(e.target.checked)}
              className="w-3 h-3"
            />
            Compare
          </label>
        </div>

        {/* Right JSON Editor Column */}
        <div className="flex flex-col flex-1 border-l border-gray-300 bg-white">
          <div className="bg-gray-200 border-b border-gray-300">
            {/* First row: Title and actions */}
            <div className="flex items-center justify-between p-2">
              <input
                type="text"
                value={rightTitle}
                onChange={(e) => setRightTitle(e.target.value)}
                className="font-semibold text-gray-700 text-sm bg-transparent border-none outline-none focus:bg-white focus:px-1 rounded"
              />
              <div className="flex gap-2">
                <button 
                  onClick={handleDownloadRight}
                  className="px-2 py-1 text-xs bg-white border border-gray-400 rounded hover:bg-gray-50 flex items-center gap-1"
                  title="Download JSON"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button 
                  onClick={handleFormatRight}
                  className="px-2 py-1 text-xs bg-white border border-gray-400 rounded hover:bg-gray-50"
                >
                  Format
                </button>
                <button 
                  onClick={handleClearRight}
                  className="px-2 py-1 text-xs bg-white border border-gray-400 rounded hover:bg-gray-50"
                >
                  Clear
                </button>
              </div>
            </div>
            {/* Second row: View mode toggle */}
            <div className="flex items-center gap-1 px-2 pb-2">
              <button
                onClick={() => setRightViewMode('text')}
                className={`px-3 py-0.5 text-xs rounded ${rightViewMode === 'text' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border border-gray-400'}`}
              >
                Text
              </button>
              <button
                onClick={() => setRightViewMode('tree')}
                className={`px-3 py-0.5 text-xs rounded ${rightViewMode === 'tree' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border border-gray-400'}`}
              >
                Tree
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {rightViewMode === 'text' ? (
              <div className="editor-wrapper">
                <Editor
                  value={rightJson}
                  onValueChange={handleRightJsonChange}
                  highlight={highlightJson}
                  padding={16}
                  textareaId="right-editor"
                  className="font-mono text-sm min-h-full code-editor"
                  textareaClassName="editor-textarea"
                  placeholder="Paste your JSON here..."
                />
              </div>
            ) : (
              <div className="p-4">
                {comparisonResult?.rightTree ? (
                  <TreeView nodes={comparisonResult.rightTree} />
                ) : rightJson.trim() ? (
                  <TreeView nodes={buildTreeChildren(JSON.parse(rightJson))} />
                ) : (
                  <span className="text-gray-400">Paste JSON to view tree</span>
                )}
              </div>
            )}
          </div>
          {rightError && (
            <div className="flex items-center justify-between px-3 py-2 text-xs text-white bg-red-500 border-t border-red-600">
              <span className="truncate flex-1">
                Line {rightError.line}, Column {rightError.column}: {rightError.message}
              </span>
              <button
                onClick={() => showErrorLocation('right', rightError.line, rightError.column)}
                className="ml-2 px-2 py-1 bg-white text-red-600 rounded font-medium hover:bg-red-50 flex-shrink-0"
              >
                Show me
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
