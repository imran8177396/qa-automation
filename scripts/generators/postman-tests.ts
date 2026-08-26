import type { PostmanAssertionsConfig, PostmanRequestConfig } from '../types';

const DEFAULT_ASSERTIONS: Required<PostmanAssertionsConfig> = {
  statusCode: 200,
  expectJson: true,
};

export function resolveAssertions(
  request: PostmanRequestConfig,
  globalAssertions?: PostmanAssertionsConfig
): Required<PostmanAssertionsConfig> {
  return {
    statusCode:
      request.assertions?.statusCode ??
      globalAssertions?.statusCode ??
      DEFAULT_ASSERTIONS.statusCode,
    expectJson:
      request.assertions?.expectJson ??
      globalAssertions?.expectJson ??
      DEFAULT_ASSERTIONS.expectJson,
  };
}

export function buildPostmanTestScript(
  assertions: Required<PostmanAssertionsConfig>
): string[] {
  const lines = [
    `pm.test("Status code is ${assertions.statusCode}", function () {`,
    `    pm.response.to.have.status(${assertions.statusCode});`,
    `});`,
  ];

  if (assertions.expectJson) {
    lines.push(
      '',
      'pm.test("Response is JSON", function () {',
      '    pm.response.to.be.json;',
      '});'
    );
  }

  return lines;
}
