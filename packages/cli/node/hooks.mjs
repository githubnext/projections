// The resolve hook register.cjs registers on Node versions without `module.registerHooks`.
let specifier
let url

export function initialize(data) {
  ;({specifier, url} = data)
}

export async function resolve(request, context, nextResolve) {
  return request === specifier ? {url, shortCircuit: true} : nextResolve(request, context)
}
