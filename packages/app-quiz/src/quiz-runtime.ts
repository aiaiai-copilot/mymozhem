import type { AppManifest, AppRuntimeModule } from '@mymozhem/sdk';
import { handleQuizPublish } from './quiz-handlers';
import { buildQuizManifest, QUIZ_APP_ID, QUIZ_MANIFEST_VERSION } from './quiz-manifest';
import { initialQuizState, reduceQuiz, type QuizState } from './quiz-state';

// Фабрика рантайм-модуля квиза (Task 4-контракт): ядро восстанавливает состояние
// редукцией лога и диспетчит publish через handlePublish (ADR-005, REQ-CTR-003).
// Фабрика чистая — никакого глобального мутабельного состояния (REQ-CORE-004).
export function createQuizRuntime(): AppRuntimeModule<QuizState> {
  return {
    appId: QUIZ_APP_ID,
    manifestVersion: QUIZ_MANIFEST_VERSION,
    manifest: buildQuizManifest(),
    initialState: initialQuizState,
    reduce: reduceQuiz,
    handlePublish: handleQuizPublish,
  };
}

export function createQuizApp(): { manifest: AppManifest; runtime: AppRuntimeModule<QuizState> } {
  const runtime = createQuizRuntime();
  return { manifest: runtime.manifest, runtime };
}
