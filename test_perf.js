const fs = require('fs');

// Simple mockup of the state
const state = {
  teams: [
    { id: 't0', name: 'Red', counselor: 'Alice' },
    { id: 't1', name: 'Blue', counselor: 'Bob' },
    { id: 't2', name: 'Green', counselor: 'Charlie' },
    { id: 't3', name: 'Yellow', counselor: 'Dave' },
    { id: 't4', name: 'Purple', counselor: 'Eve' },
    { id: 't5', name: 'Orange', counselor: 'Frank' },
  ]
};

// Current implementation
function teamNameCurrent(id) {
  const t = state.teams.find((t) => t.id === id);
  return t ? t.name : '???';
}

// Map implementation
const _teamNameCache = new Map();
function teamNameOptimizedMap(id) {
  let name = _teamNameCache.get(id);
  if (name !== undefined) return name;
  const t = state.teams.find((t) => t.id === id);
  name = t ? t.name : '???';
  _teamNameCache.set(id, name);
  return name;
}

// Plain object implementation
let _teamNameCacheObj = {};
function teamNameOptimizedObj(id) {
  if (id in _teamNameCacheObj) return _teamNameCacheObj[id];
  const t = state.teams.find((t) => t.id === id);
  const name = t ? t.name : '???';
  _teamNameCacheObj[id] = name;
  return name;
}

// Just map all at once implementation
let _teamNameMap = null;
let _teamCount = -1;
function teamNameOptimizedAll(id) {
  if (!_teamNameMap || state.teams.length !== _teamCount) {
    _teamNameMap = {};
    _teamCount = state.teams.length;
    for (let i = 0; i < _teamCount; i++) {
      _teamNameMap[state.teams[i].id] = state.teams[i].name;
    }
  }
  return _teamNameMap[id] || '???';
}

const ITERATIONS = 1000000;
const ids = ['t0', 't1', 't2', 't3', 't4', 't5', 't99'];

// Warmup
for (let i=0; i<1000; i++) {
  ids.forEach(id => {
    teamNameCurrent(id);
    teamNameOptimizedMap(id);
    teamNameOptimizedObj(id);
    teamNameOptimizedAll(id);
  });
}

const start1 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const id = ids[i % ids.length];
  teamNameCurrent(id);
}
console.log('Current:', performance.now() - start1, 'ms');

const start2 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const id = ids[i % ids.length];
  teamNameOptimizedMap(id);
}
console.log('Optimized Map:', performance.now() - start2, 'ms');

const start3 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const id = ids[i % ids.length];
  teamNameOptimizedObj(id);
}
console.log('Optimized Obj:', performance.now() - start3, 'ms');

const start4 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const id = ids[i % ids.length];
  teamNameOptimizedAll(id);
}
console.log('Optimized All:', performance.now() - start4, 'ms');
