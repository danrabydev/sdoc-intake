import type { ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  children,
  align = "start",
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={4}
        className="z-50 min-w-44 rounded-md border border-line bg-surface p-1 text-sm text-fg shadow-lg"
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  children,
  disabled,
  onSelect,
}: {
  children: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <Menu.Item
      disabled={disabled}
      onSelect={() => onSelect?.()}
      className="flex min-h-8 cursor-pointer items-center rounded px-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2"
    >
      {children}
    </Menu.Item>
  );
}
