// Native/Electron-side language pack for dialogs and desktop notifications.
// Renderer UI strings live in src/i18n.js; this file keeps main-process text out
// of electron/main.cjs so operational logic stays readable.

const MAIN_STRINGS = {
  en: {
    restartReasonSettings: 'Model/reasoning changes are not guaranteed to apply to the running gateway until it restarts',
    restartReasonBackup: 'Restored config backup is guaranteed to apply after restarting the running gateway',
    wslShutdownNotice: 'WSL has been fully shut down. Memory will be released.',
    wslShutdownButton: 'Shut down WSL',
    cancel: 'Cancel',
    wslShutdownTitle: 'Full WSL shutdown',
    wslShutdownMessage: 'Shut down WSL completely?',
    wslShutdownDetail: 'All running WSL distributions and gateways will stop immediately and memory will be released. Use the Start button to run them again.',
    wslMemoryTitle: 'WSL memory setting',
    wslMemoryApplied: (value) => value ? `WSL memory was set to ${value} (WSL restarted).` : 'WSL memory limit was removed (WSL restarted).',
    crashTitle: 'Gateway interruption detected',
    crashBody: (name) => `${name} gateway stopped unexpectedly.`,
    restartStoppedTitle: 'Auto restart stopped',
    restartStoppedBody: (name, max) => `${name}: exceeded max retries (${max}).`,
    autoRestartTitle: 'Gateway auto restart',
    autoRestartBody: (name, count, max) => `${name} (attempt ${count}/${max})`
  },
  ko: {
    restartReasonSettings: '모델/추론 설정 변경은 실행 중 gateway에 즉시 보장 적용되지 않음',
    restartReasonBackup: 'config 백업 복원은 실행 중 gateway 재시작 후 확실히 반영됨',
    wslShutdownNotice: 'WSL을 완전히 종료했습니다. 메모리가 해제됩니다.',
    wslShutdownButton: 'WSL 종료',
    cancel: '취소',
    wslShutdownTitle: 'WSL 완전 종료',
    wslShutdownMessage: 'WSL을 완전히 종료할까요?',
    wslShutdownDetail: '실행 중인 모든 WSL 배포판과 게이트웨이가 즉시 중지되고 메모리가 해제됩니다. 다시 사용하려면 시작 버튼으로 재기동해야 합니다.',
    wslMemoryTitle: 'WSL 메모리 설정',
    wslMemoryApplied: (value) => value ? `WSL 메모리를 ${value}로 적용했습니다 (WSL 재시작됨).` : 'WSL 메모리 제한을 해제했습니다 (WSL 재시작됨).',
    crashTitle: '게이트웨이 중단 감지',
    crashBody: (name) => `${name} 게이트웨이가 예기치 않게 종료됐습니다.`,
    restartStoppedTitle: '자동 재시작 중단',
    restartStoppedBody: (name, max) => `${name}: 최대 재시도(${max})를 초과했습니다.`,
    autoRestartTitle: '게이트웨이 자동 재시작',
    autoRestartBody: (name, count, max) => `${name} (시도 ${count}/${max})`
  },
  zh: {
    restartReasonSettings: '模型/推理设置变更在运行中的网关重启前不保证生效',
    restartReasonBackup: '恢复的 config 备份会在运行中的网关重启后确定生效',
    wslShutdownNotice: 'WSL 已完全关闭。内存将被释放。',
    wslShutdownButton: '关闭 WSL',
    cancel: '取消',
    wslShutdownTitle: '完全关闭 WSL',
    wslShutdownMessage: '要完全关闭 WSL 吗？',
    wslShutdownDetail: '所有正在运行的 WSL 发行版和网关会立即停止并释放内存。需要再次使用时，请按 Start 重新启动。',
    wslMemoryTitle: 'WSL 内存设置',
    wslMemoryApplied: (value) => value ? `WSL 内存已设置为 ${value}（WSL 已重启）。` : 'WSL 内存限制已解除（WSL 已重启）。',
    crashTitle: '检测到网关中断',
    crashBody: (name) => `${name} 网关意外停止。`,
    restartStoppedTitle: '自动重启已停止',
    restartStoppedBody: (name, max) => `${name}: 已超过最大重试次数（${max}）。`,
    autoRestartTitle: '网关自动重启',
    autoRestartBody: (name, count, max) => `${name}（尝试 ${count}/${max}）`
  },
  ja: {
    restartReasonSettings: 'モデル/推論設定の変更は、実行中のゲートウェイ再起動まで確実には反映されません',
    restartReasonBackup: '復元した config バックアップは、実行中のゲートウェイ再起動後に確実に反映されます',
    wslShutdownNotice: 'WSL を完全に終了しました。メモリが解放されます。',
    wslShutdownButton: 'WSL を終了',
    cancel: 'キャンセル',
    wslShutdownTitle: 'WSL 完全終了',
    wslShutdownMessage: 'WSL を完全に終了しますか？',
    wslShutdownDetail: '実行中のすべての WSL ディストリビューションとゲートウェイが直ちに停止し、メモリが解放されます。再度使うには Start ボタンで起動してください。',
    wslMemoryTitle: 'WSL メモリ設定',
    wslMemoryApplied: (value) => value ? `WSL メモリを ${value} に設定しました（WSL 再起動済み）。` : 'WSL メモリ制限を解除しました（WSL 再起動済み）。',
    crashTitle: 'ゲートウェイ中断を検知',
    crashBody: (name) => `${name} ゲートウェイが予期せず停止しました。`,
    restartStoppedTitle: '自動再起動を停止',
    restartStoppedBody: (name, max) => `${name}: 最大再試行回数（${max}）を超えました。`,
    autoRestartTitle: 'ゲートウェイ自動再起動',
    autoRestartBody: (name, count, max) => `${name}（試行 ${count}/${max}）`
  }
};

function makeMainStrings(language) {
  return { ...MAIN_STRINGS.en, ...(MAIN_STRINGS[language] || {}) };
}

module.exports = { makeMainStrings };
