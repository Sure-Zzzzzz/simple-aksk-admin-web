import type { VueWrapper } from '@vue/test-utils';

/**
 * 测试助手：驱动自绘下拉 FormSelect（按钮 + 弹层，无原生 select 可 setValue）。
 * 按 aria-label 或序号定位，打开菜单后点击目标选项完成选择。
 */
export async function pickFormSelectOption(
  wrapper: VueWrapper,
  locator: { ariaLabel?: string; index?: number },
  optionLabel: string
): Promise<void> {
  const scope = locator.ariaLabel
    ? wrapper.findAll('.form-select-toggle').find(node => node.attributes('aria-label') === locator.ariaLabel)?.element
        .parentElement
    : wrapper.findAll('.form-select')[locator.index ?? 0]?.element;
  if (!scope) {
    throw new Error(`FormSelect 未找到：${locator.ariaLabel ?? `#${locator.index ?? 0}`}`);
  }
  const toggle = scope.querySelector('.form-select-toggle') as HTMLElement | null;
  if (!toggle) {
    throw new Error(`FormSelect 无 toggle：${locator.ariaLabel ?? `#${locator.index ?? 0}`}`);
  }
  toggle.click();
  await wrapper.vm.$nextTick();
  const option = Array.from(scope.querySelectorAll('.form-select-option'))
    .find(node => node.textContent?.trim() === optionLabel);
  if (!option) {
    throw new Error(`选项「${optionLabel}」未找到：${locator.ariaLabel ?? `#${locator.index ?? 0}`}`);
  }
  (option as HTMLElement).click();
  await wrapper.vm.$nextTick();
}

/** 读取 FormSelect 当前展示文案（对应原生 select 的选中项 label）。 */
export function formSelectDisplay(
  wrapper: VueWrapper,
  locator: { ariaLabel?: string; index?: number }
): string {
  const toggle = locator.ariaLabel
    ? wrapper.findAll('.form-select-toggle').find(node => node.attributes('aria-label') === locator.ariaLabel)
    : wrapper.findAll('.form-select-toggle')[locator.index ?? 0];
  if (!toggle) {
    throw new Error(`FormSelect 未找到：${locator.ariaLabel ?? `#${locator.index ?? 0}`}`);
  }
  return toggle.get('.form-select-value').text();
}
