import React, { useState, useMemo } from 'react';
import { Network, ZoomIn, ZoomOut, RotateCcw, Info, CheckCircle2 } from 'lucide-react';
import type { SymbolEntry } from '../types';

interface RadixTrieVisualizerProps {
  symbols: SymbolEntry[];
}

interface TrieNode {
  id: number;
  edgeLabel: string;
  isTerminal: boolean;
  symbolName?: string;
  symbolType?: string;
  arenaIndex: number;
  children: TrieNode[];
}

export const RadixTrieVisualizer: React.FC<RadixTrieVisualizerProps> = ({ symbols }) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedNode, setSelectedNode] = useState<TrieNode | null>(null);

  // Build the Radix Trie from symbol identifiers
  const { root, totalNodes, totalDeduplicatedBytes, rawStringBytes } = useMemo(() => {
    let nodeIdCounter = 0;
    let arenaIndexCounter = 0;

    const rootNode: TrieNode = {
      id: nodeIdCounter++,
      edgeLabel: '<ROOT>',
      isTerminal: false,
      arenaIndex: arenaIndexCounter++,
      children: [],
    };

    let totalRawBytes = 0;

    // Helper to insert an identifier into the Radix Trie
    function insert(node: TrieNode, word: string, symbol: SymbolEntry) {
      totalRawBytes += word.length + 1;

      // Check if any child shares a prefix with the word
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const edge = child.edgeLabel;

        // Find common prefix length
        let common = 0;
        while (common < edge.length && common < word.length && edge[common] === word[common]) {
          common++;
        }

        if (common > 0) {
          if (common === edge.length) {
            // Full edge matches; recurse with remainder
            if (common === word.length) {
              child.isTerminal = true;
              child.symbolName = symbol.name;
              child.symbolType = symbol.type;
              return;
            }
            insert(child, word.slice(common), symbol);
            return;
          } else {
            // Split edge at common prefix (Radix / Patricia compression)
            const splitNode: TrieNode = {
              id: nodeIdCounter++,
              edgeLabel: edge.slice(0, common),
              isTerminal: common === word.length,
              symbolName: common === word.length ? symbol.name : undefined,
              symbolType: common === word.length ? symbol.type : undefined,
              arenaIndex: arenaIndexCounter++,
              children: [],
            };

            // Existing child gets tail label
            child.edgeLabel = edge.slice(common);
            splitNode.children.push(child);

            // Replace child in current node
            node.children[i] = splitNode;

            if (common < word.length) {
              // Add remainder as new child
              splitNode.children.push({
                id: nodeIdCounter++,
                edgeLabel: word.slice(common),
                isTerminal: true,
                symbolName: symbol.name,
                symbolType: symbol.type,
                arenaIndex: arenaIndexCounter++,
                children: [],
              });
            }
            return;
          }
        }
      }

      // No common prefix with any child, create new branch
      node.children.push({
        id: nodeIdCounter++,
        edgeLabel: word,
        isTerminal: true,
        symbolName: symbol.name,
        symbolType: symbol.type,
        arenaIndex: arenaIndexCounter++,
        children: [],
      });
    }

    // Insert all unique symbols
    symbols.forEach((sym) => {
      insert(rootNode, sym.name, sym);
    });

    // Calculate total edge character storage
    function countEdgeBytes(node: TrieNode): number {
      let count = node.id === 0 ? 0 : node.edgeLabel.length;
      for (const ch of node.children) {
        count += countEdgeBytes(ch);
      }
      return count;
    }

    const deduplicatedBytes = countEdgeBytes(rootNode);

    return {
      root: rootNode,
      totalNodes: arenaIndexCounter,
      totalDeduplicatedBytes: deduplicatedBytes,
      rawStringBytes: totalRawBytes,
    };
  }, [symbols]);

  const prefixSavedBytes = Math.max(0, rawStringBytes - totalDeduplicatedBytes);

  // Recursive component to render Trie nodes and edges
  const renderTrieBranch = (node: TrieNode, depth = 0) => {
    const isSelected = selectedNode?.id === node.id;

    return (
      <div key={node.id} className="flex flex-col items-center">
        {/* Node Box */}
        <div
          onClick={() => setSelectedNode(node)}
          className={`cursor-pointer rounded-lg px-3 py-2 border transition-all duration-150 select-none flex flex-col items-center min-w-[100px] text-center shadow-2xs ${
            node.id === 0
              ? 'bg-white border-2 border-slate-300 text-slate-800'
              : node.isTerminal
              ? isSelected
                ? 'bg-orange-100 border-2 border-orange-600 text-orange-950 ring-2 ring-orange-500/30'
                : 'bg-orange-50 border border-orange-300 text-orange-950 hover:border-orange-500'
              : isSelected
              ? 'bg-teal-100 border-2 border-teal-700 text-teal-950 ring-2 ring-teal-500/30'
              : 'bg-teal-50 border border-teal-300 text-teal-900 hover:border-teal-500'
          }`}
        >
          {/* Edge Label / Prefix */}
          <div className="flex items-center space-x-1 font-mono font-bold text-xs">
            {node.id === 0 ? (
              <span className="text-slate-500">ROOT</span>
            ) : (
              <span>"{node.edgeLabel}"</span>
            )}
          </div>

          {/* Arena Index / Leaf Tag */}
          <div className="flex items-center space-x-1 mt-1 text-[10px] font-mono">
            <span className="px-1.5 py-0.2 rounded bg-white/80 border border-slate-200 text-slate-600">
              arena[{node.arenaIndex}]
            </span>
            {node.isTerminal && (
              <span className="px-1 rounded bg-orange-100 text-orange-800 font-semibold border border-orange-200">
                sym
              </span>
            )}
          </div>

          {node.symbolType && (
            <span className="text-[10px] text-teal-700 font-mono mt-0.5">
              {node.symbolType}
            </span>
          )}
        </div>

        {/* Children Branches */}
        {node.children.length > 0 && (
          <div className="flex flex-col items-center w-full">
            {/* Vertical connector from parent */}
            <div className="w-0.5 h-6 bg-slate-300" />

            {/* Horizontal Branch Bar */}
            <div className="relative flex justify-center gap-4 sm:gap-6 pt-0">
              {node.children.length > 1 && (
                <div
                  className="absolute top-0 h-0.5 bg-slate-300"
                  style={{
                    left: `calc(100% / ${node.children.length * 2})`,
                    right: `calc(100% / ${node.children.length * 2})`,
                  }}
                />
              )}

              {/* Children Nodes */}
              {node.children.map((child) => (
                <div key={child.id} className="flex flex-col items-center">
                  <div className="w-0.5 h-4 bg-slate-300" />
                  {renderTrieBranch(child, depth + 1)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (symbols.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
      {/* Header Bar */}
      <div className="p-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Network className="w-4 h-4 text-teal-700" />
            <h3 className="text-base font-bold text-slate-900">
              Radix (Patricia) Trie Visualizer
            </h3>
            <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
              Prefix Intern Table
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Edges represent compacted prefix strings. The trie replaces independent heap allocations for identifier names.
          </p>
        </div>

        {/* Quick Zoom & Reset Controls */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.15))}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 transition-colors shadow-2xs"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-600 min-w-[42px] text-center font-medium">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(1.4, z + 0.15))}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 transition-colors shadow-2xs"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel(1)}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 transition-colors shadow-2xs"
            title="Reset Zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center space-x-4">
          <div>
            <span className="text-slate-500">Arena Nodes:</span>{' '}
            <span className="text-teal-800 font-bold">{totalNodes}</span>
          </div>
          <div>
            <span className="text-slate-500">Prefix Characters Spared:</span>{' '}
            <span className="text-orange-600 font-bold">{prefixSavedBytes} chars</span>
          </div>
          <div>
            <span className="text-slate-500">Edge Storage:</span>{' '}
            <span className="text-slate-800 font-bold">{totalDeduplicatedBytes} B</span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 font-sans text-slate-500 text-[11px]">
          <Info className="w-3.5 h-3.5 text-teal-700" />
          <span>Click any node to inspect prefix edge & 16-bit arena offset</span>
        </div>
      </div>

      {/* Node Inspector Drawer if selected */}
      {selectedNode && (
        <div className="px-4 py-2.5 bg-teal-50/70 border-b border-teal-200 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-teal-900">
              Selected Edge: <code className="bg-white border border-teal-200 px-1.5 py-0.5 rounded text-teal-950 font-bold">"{selectedNode.edgeLabel}"</code>
            </span>
            <span className="text-slate-600 font-mono">
              Arena Index: <code className="text-teal-800 font-bold">arena[{selectedNode.arenaIndex}]</code> (16-bit relative index)
            </span>
            {selectedNode.isTerminal && selectedNode.symbolName && (
              <span className="text-orange-700 font-mono flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-orange-600" />
                <span>Full Symbol: <strong>{selectedNode.symbolName}</strong> ({selectedNode.symbolType})</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectedNode(null)}
            className="text-xs text-teal-800 hover:text-teal-950 underline font-sans"
          >
            Close
          </button>
        </div>
      )}

      {/* Interactive Graph Canvas / Tree View */}
      <div className="p-8 overflow-x-auto min-h-[460px] max-h-[560px] bg-slate-50/40 flex justify-center items-start">
        <div
          className="transition-transform duration-150 origin-top flex justify-center pb-8"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {renderTrieBranch(root)}
        </div>
      </div>

      {/* Visualizer Footer Explainer */}
      <div className="p-3 bg-white border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
        <span>
          🌳 <strong className="text-slate-700">Patricia Trie Guarantee:</strong> Common prefix characters are interned in contiguous 16-bit indexed arena nodes.
        </span>
        <span className="font-mono text-teal-700 font-semibold">Zero 64-bit Pointer Bloat</span>
      </div>
    </div>
  );
};
