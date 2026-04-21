import { forwardRef, type CSSProperties, type KeyboardEvent } from 'react';

/**
 * 全アプリ共通のテキスト入力。
 *
 * - `onSubmit` が渡されたときは Enter で発火、ただし **IME 変換確定の Enter は無視** する。
 *   (e.nativeEvent.isComposing でチェック)
 * - 通常の onChange は string を直接受け取る (イベントを触る必要がない)
 * - multiline=true で textarea に切り替わる
 */

interface BaseProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (() => void) | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  style?: CSSProperties | undefined;
  className?: string | undefined;
  autoFocus?: boolean | undefined;
  maxLength?: number | undefined;
  'aria-label'?: string | undefined;
}

type SingleLineProps = BaseProps & {
  multiline?: false | undefined;
  type?: 'text' | 'password' | 'email' | 'url' | undefined;
};

type MultiLineProps = BaseProps & {
  multiline: true;
  rows?: number | undefined;
  /** Ctrl/Cmd + Enter で送信。生の Enter は改行として扱う。 */
  submitWithModifier?: boolean | undefined;
};

export type TextFieldProps = SingleLineProps | MultiLineProps;

export const TextField = forwardRef<HTMLInputElement | HTMLTextAreaElement, TextFieldProps>(
  function TextField(props, ref) {
    const common = {
      value: props.value,
      placeholder: props.placeholder,
      disabled: props.disabled,
      style: props.style,
      className: props.className,
      autoFocus: props.autoFocus,
      maxLength: props.maxLength,
      'aria-label': props['aria-label'],
    };

    const isMultiline = props.multiline === true;
    const submitWithModifier = isMultiline && (props as MultiLineProps).submitWithModifier === true;

    const handleKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!props.onSubmit) return;
      if (e.key !== 'Enter') return;
      if (e.nativeEvent.isComposing) return; // IME 変換確定の Enter
      if (isMultiline && !submitWithModifier) return; // 複数行で Ctrl/Cmd 指定なし → 改行に任せる
      if (submitWithModifier && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      props.onSubmit();
    };

    if (isMultiline) {
      const p = props as MultiLineProps;
      return (
        <textarea
          {...common}
          ref={ref as React.Ref<HTMLTextAreaElement>}
          rows={p.rows}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={handleKey}
        />
      );
    }

    const p = props as SingleLineProps;
    return (
      <input
        {...common}
        ref={ref as React.Ref<HTMLInputElement>}
        type={p.type ?? 'text'}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={handleKey}
      />
    );
  },
);
