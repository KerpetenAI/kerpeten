/** The early result of a workflow, returned by a flow step through `this.end(result)`. The later flow steps do not run. */
export class WorkflowEnd<Result> {
  private readonly value: Result;

  public constructor(value: Result) {
    this.value = value;
  }

  public get result(): Result {
    return this.value;
  }
}
