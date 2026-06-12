export type TemplatePrimitive = string | number | boolean | null | undefined;
export type TemplateValue = TemplatePrimitive | TemplateValue[] | { [key: string]: TemplateValue };
export type TemplateVariables = Record<string, TemplateValue>;
export type TemplatePartials = Record<string, string>;

type RenderScope = {
  value: TemplateValue;
  root: TemplateVariables;
  parent?: RenderScope;
};

type TextNode = {
  type: "text";
  value: string;
};

type VariableNode = {
  type: "variable";
  path: string;
};

type PartialNode = {
  type: "partial";
  name: string;
};

type IfNode = {
  type: "if";
  path: string;
  children: TemplateNode[];
  elseChildren: TemplateNode[];
};

type EachNode = {
  type: "each";
  path: string;
  children: TemplateNode[];
};

type TemplateNode = TextNode | VariableNode | PartialNode | IfNode | EachNode;

type Token = { type: "text"; value: string } | { type: "tag"; value: string };

type ParseResult = {
  nodes: TemplateNode[];
  index: number;
  stopTag?: string;
};

const tagPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

const tokenize = (template: string): Token[] => {
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of template.matchAll(tagPattern)) {
    if (match.index > cursor) {
      tokens.push({ type: "text", value: template.slice(cursor, match.index) });
    }
    tokens.push({ type: "tag", value: match[1].trim() });
    cursor = match.index + match[0].length;
  }

  if (cursor < template.length) {
    tokens.push({ type: "text", value: template.slice(cursor) });
  }

  return tokens;
};

const parseNodes = (tokens: Token[], index: number, stopTags: string[]): ParseResult => {
  const nodes: TemplateNode[] = [];
  let cursor = index;

  while (cursor < tokens.length) {
    const token = tokens[cursor];

    if (token.type === "text") {
      nodes.push({ type: "text", value: token.value });
      cursor += 1;
      continue;
    }

    if (stopTags.includes(token.value)) {
      return { nodes, index: cursor + 1, stopTag: token.value };
    }

    if (token.value.startsWith("#if ")) {
      const path = token.value.slice(4).trim();
      const truthyBranch = parseNodes(tokens, cursor + 1, ["else", "/if"]);
      let elseChildren: TemplateNode[] = [];
      let nextIndex = truthyBranch.index;

      if (truthyBranch.stopTag === "else") {
        const falseyBranch = parseNodes(tokens, nextIndex, ["/if"]);
        elseChildren = falseyBranch.nodes;
        nextIndex = falseyBranch.index;
        if (falseyBranch.stopTag !== "/if") {
          throw new Error(`Unclosed if block for "${path}".`);
        }
      } else if (truthyBranch.stopTag !== "/if") {
        throw new Error(`Unclosed if block for "${path}".`);
      }

      nodes.push({ type: "if", path, children: truthyBranch.nodes, elseChildren });
      cursor = nextIndex;
      continue;
    }

    if (token.value.startsWith("#each ")) {
      const path = token.value.slice(6).trim();
      const body = parseNodes(tokens, cursor + 1, ["/each"]);
      if (body.stopTag !== "/each") {
        throw new Error(`Unclosed each block for "${path}".`);
      }
      nodes.push({ type: "each", path, children: body.nodes });
      cursor = body.index;
      continue;
    }

    if (token.value.startsWith(">")) {
      nodes.push({ type: "partial", name: token.value.slice(1).trim() });
      cursor += 1;
      continue;
    }

    if (token.value.startsWith("/") || token.value === "else") {
      throw new Error(`Unexpected template tag "{{${token.value}}}".`);
    }

    nodes.push({ type: "variable", path: token.value });
    cursor += 1;
  }

  return { nodes, index: cursor };
};

export const parseTemplate = (template: string): TemplateNode[] => {
  const tokens = tokenize(template);
  const result = parseNodes(tokens, 0, []);
  return result.nodes;
};

const isObjectRecord = (value: TemplateValue): value is Record<string, TemplateValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getProperty = (value: TemplateValue, key: string): TemplateValue => {
  if (isObjectRecord(value)) {
    return value[key];
  }
  return undefined;
};

const resolvePath = (path: string, scope: RenderScope): TemplateValue => {
  const trimmed = path.trim();
  if (trimmed === "this" || trimmed === ".") {
    return scope.value;
  }

  if (trimmed.startsWith("../")) {
    return scope.parent ? resolvePath(trimmed.slice(3), scope.parent) : undefined;
  }

  const exactLocal = getProperty(scope.value, trimmed);
  if (exactLocal !== undefined) {
    return exactLocal;
  }
  if (scope.root[trimmed] !== undefined) {
    return scope.root[trimmed];
  }

  const parts = trimmed.split(".").filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  const firstLocal = getProperty(scope.value, parts[0]);
  let current = firstLocal !== undefined ? firstLocal : scope.root[parts[0]];

  for (const part of parts.slice(1)) {
    current = getProperty(current, part);
  }

  return current;
};

const isTruthy = (value: TemplateValue): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isObjectRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
};

export const stringifyTemplateValue = (value: TemplateValue): string => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyTemplateValue(item))
      .filter((item) => item.length > 0)
      .join(", ");
  }
  if (isObjectRecord(value)) {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

const renderNodes = (
  nodes: TemplateNode[],
  scope: RenderScope,
  partials: TemplatePartials,
  partialStack: string[]
): string => {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }

      if (node.type === "variable") {
        return stringifyTemplateValue(resolvePath(node.path, scope));
      }

      if (node.type === "if") {
        const branch = isTruthy(resolvePath(node.path, scope)) ? node.children : node.elseChildren;
        return renderNodes(branch, scope, partials, partialStack);
      }

      if (node.type === "each") {
        const value = resolvePath(node.path, scope);
        const items = Array.isArray(value) ? value : [];
        return items
          .map((item) =>
            renderNodes(node.children, { value: item, root: scope.root, parent: scope }, partials, partialStack)
          )
          .join("");
      }

      const partial = partials[node.name];
      if (partial === undefined) {
        return "";
      }
      if (partialStack.includes(node.name)) {
        throw new Error(`Recursive partial "${node.name}" is not supported.`);
      }
      return renderNodes(parseTemplate(partial), scope, partials, [...partialStack, node.name]);
    })
    .join("");
};

export const renderTemplate = (
  template: string,
  variables: TemplateVariables = {},
  partials: TemplatePartials = {}
): string => {
  const rootScope: RenderScope = {
    value: variables,
    root: variables
  };

  return renderNodes(parseTemplate(template), rootScope, partials, []);
};
