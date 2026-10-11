import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('sample price initializer and reset never use cost; acceptance requires an explicit valid price', async () => {
  const hooks = { states: [], cursor: 0, effects: [] };
  globalThis.__samplePriceTest = hooks;
  try {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('./SampleWorkflowActions.tsx', import.meta.url))],
      bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
      plugins: [{ name: 'isolated-component-dependencies', setup(builder) {
        builder.onResolve({ filter: /^(react|@|sonner)/ }, args => ({ path: args.path, namespace: 'mock' }));
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
          let contents;
          if (path === 'react') contents = `
            const h=globalThis.__samplePriceTest;
            export function useState(initial){const i=h.cursor++;if(!(i in h.states))h.states[i]=initial;return [h.states[i],v=>h.states[i]=typeof v==='function'?v(h.states[i]):v]}
            export function useRef(initial){const i=h.cursor++;if(!(i in h.states))h.states[i]={current:initial};return h.states[i]}
            export function useEffect(fn){h.effects.push(fn)}
          `;
          else if (path === 'react/jsx-runtime') contents = 'export const Fragment="Fragment";export function jsx(type,props){return {type,props}};export const jsxs=jsx;';
          else if (path === '@tanstack/react-query') contents = 'export function useQuery(){return {data:{ready:true,isBoss:true}}}';
          else if (path.endsWith('/button')) contents = 'export const Button="button";';
          else if (path.endsWith('/input')) contents = 'export const Input="input";';
          else if (path.endsWith('/label')) contents = 'export const Label="label";';
          else if (path.endsWith('/utils')) contents = 'export const resizeImage=async x=>x;';
          else if (path.endsWith('/sampleWorkflow')) contents = 'export const sampleBillable=()=>false;export const sampleWorkflowRequest=()=>{throw Error("No API calls permitted")};';
          else if (path.endsWith('/store')) contents = 'export const normalizeBrands=x=>x||[];';
          else if (path.endsWith('/WorkCardActions')) contents = 'export const announceWorkChanged=()=>{};';
          else if (path === 'sonner') contents = 'export const toast={success(){},warning(){},error(){}};';
          else throw Error(`Unexpected dependency: ${path}`);
          return { contents, loader: 'js' };
        });
      } }],
    });
    const { SampleWorkflowActions } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const base = { id: 'synthetic', workflowVersion: 1, styleName: 'Synthetic sample', buyerId: 'synthetic-buyer', costKrw: 45000,
      completedAt: '2026-10-11T00:00:00Z', reviewStatus: 'pending', imageUrls: ['synthetic-photo'] };
    function render(sample) {
      hooks.cursor = 0; hooks.effects = [];
      return SampleWorkflowActions({ sample, vendors: [], onSaved() {}, onBill() {} });
    }
    function nodes(node) {
      if (!node || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap(nodes);
      return [node, ...nodes(node.props?.children)];
    }
    const price = tree => nodes(tree).find(node => node.props?.id === 'sample-review-price');
    const accept = tree => nodes(tree).find(node => node.type === 'button' && node.props.children === '수락');
    let tree = render(base);
    assert.equal(price(tree).props.value, '');
    assert.equal(accept(tree).props.disabled, true);
    for (const [sampleUnitPrice, expected] of [[0, '0'], [12000, '12000'], [undefined, ''], [null, '']]) {
      const sample = { ...base, workflowVersion: base.workflowVersion++, sampleUnitPrice };
      render(sample); hooks.effects.forEach(effect => effect()); tree = render(sample);
      assert.equal(price(tree).props.value, expected, `reset ${sampleUnitPrice}`);
      assert.equal(accept(tree).props.disabled, expected === '');
    }
    for (const [input, disabled] of [['', true], ['  ', true], ['NaN', true], ['Infinity', true], ['-1', true], ['0', false], ['5000', false]]) {
      price(tree).props.onChange({ target: { value: input } }); tree = render(base);
      assert.equal(accept(tree).props.disabled, disabled, `required price ${JSON.stringify(input)}`);
    }
    hooks.states = []; tree = render({ ...base, sampleUnitPrice: 0 });
    assert.equal(price(tree).props.value, '0'); assert.equal(accept(tree).props.disabled, false);
  } finally { delete globalThis.__samplePriceTest; }
});
