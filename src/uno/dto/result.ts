
export interface Result<T> {
  success: boolean;
  reason: string
  result?: T
}
