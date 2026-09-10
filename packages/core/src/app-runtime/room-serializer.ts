// Per-room очередь диспетчей (одна реплика, REQ-OPS-005).
// Без неё два конкурентных publish прочитают одну и ту же проекцию до коммита
// друг друга (double-answer гонка, design §7.3). Состояние — поле экземпляра,
// пересоздаваемо (REQ-CORE-004): потеря записи = потеря лишь упорядочения в полёте.
export class RoomSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(roomId) ?? Promise.resolve();
    const run = tail.then(() => fn());
    // Цепочка не должна расти бесконечно и не должна протухать: маркер заменяется
    // на settle нового звена; когда звено последнее — запись удаляется.
    const marker = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(roomId, marker);
    void marker.then(() => {
      if (this.tails.get(roomId) === marker) this.tails.delete(roomId);
    });
    return run;
  }
}
