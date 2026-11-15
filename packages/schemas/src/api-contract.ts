// The `api/v0` declarations' contract facts: the record every public API extractor writes in `data.contract`,
// in terms every ecosystem shares. Part of the domain schemas' data rules (`./domains.ts`).

/** API declaration kinds, which carry a signature. */
export const apiDeclarationKinds = ['export', 'type', 'member', 'function', 'class', 'interface', 'method', 'property', 'enum'] as const

/** Who can use a declaration or accessor: everyone, or only subclasses (and, for .NET's `protected internal`, its assembly). */
const visibility = {type: 'enum', values: ['public', 'protected']} as const

/** The kinds of declaration every ecosystem's contract facts name; `term` keeps the ecosystem's own word. */
export const apiDeclarations = [
  'package',
  'module',
  'class',
  'struct',
  'union',
  'enum',
  'interface',
  'alias',
  'type',
  'function',
  'method',
  'constructor',
  'property',
  'field',
  'variant',
  'constant',
  'variable',
  'event',
  'index',
  'call',
  'construct',
  'associated-type',
  'implementation',
  're-export',
  'macro',
] as const

const apiType = {
  type: 'record',
  name: 'typeRef',
  about: 'A type where values flow: its text as the language writes it, and, when the extractor resolves it, its union constituents.',
  fields: {
    text: {
      type: 'string',
      required: true,
      description: 'The type as the language writes it, such as `System.Int32` or `number | undefined`.',
    },
    union: {
      type: 'array',
      items: {
        type: 'record',
        name: 'constituent',
        about: 'One member of a union type.',
        fields: {
          text: {type: 'string', required: true, description: 'The constituent as the language writes it, such as `"low"`.'},
          primitive: {
            type: 'string',
            description: 'The primitive it is, or a literal of it widens to, such as `string` or `undefined`; absent for other types.',
          },
        },
      },
      description: 'Each constituent of the type, a single one when it is no union; absent when the extractor resolves no unions.',
    },
  },
} as const

const apiTypeParameters = {
  type: 'array',
  items: {
    type: 'record',
    name: 'typeParameter',
    about: 'A generic parameter.',
    fields: {
      name: {type: 'string', required: true, description: "The parameter's name, such as `T` or Rust's lifetime `'a`."},
      constraints: {
        type: 'strings',
        required: true,
        description: 'What an argument must satisfy, each as the language writes it: bounds, constraints or a single constraint type.',
      },
      default: {type: 'string', description: 'The argument used when none is given.'},
      type: {type: 'string', description: "A value parameter's type, such as a Rust `const` generic's `usize`."},
    },
  },
} as const

export const apiContract = {
  type: 'record',
  name: 'contract',
  about:
    "The language-neutral facts compatibility rules read about one declaration. Booleans that are absent are false. Facts only one ecosystem's rules read are in `native`.",
  fields: {
    declaration: {type: 'enum', values: apiDeclarations, required: true, description: 'What kind of declaration it is.'},
    term: {
      type: 'text',
      required: true,
      description:
        "The ecosystem's own word for the kind of declaration, such as Rust's `trait-method`, Go's `func` or .NET's `record class`; a change of `term` is a change of kind.",
    },
    visibility: {...visibility, required: true, description: 'Who can use it.'},
    static: {type: 'boolean', description: 'It belongs to its type rather than to instances.'},
    abstract: {
      type: 'boolean',
      description:
        "It has no implementation: implementers or subclasses must provide it (.NET `abstract` members and interface members without a default body, TypeScript's `abstract`, Rust trait items without a default, Go interface methods); a class that is abstract can't be instantiated.",
    },
    sealed: {
      type: 'boolean',
      description:
        "Consumers can't inherit or implement it: a .NET type that is sealed, static or has no accessible constructor; a Rust trait with a supertrait outside the public API; a Go interface with unexported methods.",
    },
    readonly: {
      type: 'boolean',
      description:
        "Consumers can read it but not assign it: .NET `readonly` fields, TypeScript `readonly` properties, Rust statics that aren't `mut`.",
    },
    required: {type: 'boolean', description: 'Code creating an instance must set it: .NET `required` members.'},
    optional: {type: 'boolean', description: 'It may be absent: a TypeScript optional (`?`) member.'},
    nonExhaustive: {
      type: 'boolean',
      description:
        'It may gain members without a breaking change, so consumers may not match every variant or name every field in literals and patterns: Rust `#[non_exhaustive]`.',
    },
    hiddenMembers: {
      type: 'boolean',
      description:
        "It has fields or variants consumers can't see, so they can't construct it from its fields or destructure it exhaustively: Rust private fields and hidden variants.",
    },
    type: {
      ...apiType,
      description:
        "Its type: a field's, property's, variable's, constant's or event's; the type an alias names; the type an implementation is for; a Go function's or method's type.",
    },
    value: {type: 'string', description: "A constant's or enum member's value, as the language writes it."},
    underlying: {type: 'string', description: "The type an enum or a defined type is represented by: a .NET enum's, a Go defined type's."},
    source: {type: 'string', description: 'What a re-export re-exports, as a path.'},
    access: {
      type: 'record',
      name: 'access',
      about: "A property's accessors, each with who can use it; an accessor that is absent doesn't exist.",
      fields: {
        read: {...visibility, description: 'The getter.'},
        write: {...visibility, description: 'The setter.'},
        init: {...visibility, description: 'An accessor that sets it only while an instance is created: .NET `init`.'},
      },
      description: "A property's accessors.",
    },
    attributes: {
      type: 'strings',
      description: 'Its attributes or annotations, each as the language writes it, such as .NET `System.ObsoleteAttribute("Use Run")`.',
    },
    signatures: {
      type: 'array',
      items: {
        type: 'record',
        name: 'signature',
        about: 'One way to call or construct a declaration.',
        fields: {
          parameters: {
            type: 'array',
            required: true,
            items: {
              type: 'record',
              name: 'parameter',
              about: 'A parameter, in position order.',
              fields: {
                name: {type: 'string', required: true, description: "The parameter's name."},
                type: {...apiType, required: true, description: "The parameter's type."},
                optional: {type: 'boolean', required: true, description: 'Callers may omit it.'},
                variadic: {
                  type: 'boolean',
                  required: true,
                  description: 'It takes any number of arguments: a TypeScript rest parameter, a .NET `params` array.',
                },
                default: {type: 'string', description: 'The value an omitted argument takes, as the language writes it.'},
                passing: {
                  type: 'enum',
                  values: ['value', 'ref', 'out', 'in', 'ref readonly'],
                  required: true,
                  description: 'How the argument is passed: by `value`, or by reference as .NET `ref`, `out`, `in` and `ref readonly`.',
                },
                attributes: {type: 'strings', description: "The parameter's attributes, as the language writes them."},
              },
            },
            description: 'Its parameters, in order.',
          },
          returns: {...apiType, required: true, description: "What a call returns; a constructor its instance, or the language's void."},
          returnAttributes: {type: 'strings', description: 'Attributes of what it returns, as the language writes them.'},
          typeParameters: {...apiTypeParameters, description: 'Its generic parameters.'},
        },
      },
      description:
        'How it is called or constructed: one signature, or each overload in order. An indexer has one, whose parameters are its keys.',
    },
    typeParameters: {...apiTypeParameters, description: "Its generic parameters; a callable's are its signatures'."},
    supertypes: {
      type: 'array',
      items: {
        type: 'record',
        name: 'supertype',
        about: 'A type a declaration derives from or implements.',
        fields: {
          relation: {
            type: 'enum',
            values: ['extends', 'implements'],
            required: true,
            description:
              'Whether it derives from the type (a base class, a supertrait, an interface an interface extends) or implements it.',
          },
          type: {type: 'string', required: true, description: 'The type, as the language writes it.'},
        },
      },
      description:
        'What it derives from or implements, as its ecosystem lists them: .NET base types and every implemented interface, TypeScript heritage clauses, Rust supertraits and the trait an implementation implements, the Go interfaces of the package a type implements.',
    },
    constraints: {type: 'strings', description: 'What an associated type must satisfy, each as the language writes it.'},
    native: {
      type: 'object',
      description:
        "Ecosystem-specific facts, read only by that ecosystem's compatibility rules. Each public API extractor documents its own.",
    },
  },
} as const
