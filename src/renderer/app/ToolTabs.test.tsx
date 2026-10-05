import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OVERVIEW_TAB, ToolTabs } from './ToolTabs';

const tools = [
  { id: 'project-info', name: 'Project info', icon: 'info' },
  { id: 'scripts', name: 'Scripts', icon: 'terminal' },
];

function Harness() {
  const [active, setActive] = useState(OVERVIEW_TAB);
  return <ToolTabs projectId="p1" tools={tools} active={active} onSelect={setActive} />;
}

describe('ToolTabs', () => {
  it('follows the tabs pattern', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.id)).toEqual([
      'tab-p1-overview',
      'tab-p1-project-info',
      'tab-p1-scripts',
    ]);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    tabs.forEach((t) => expect(t).toHaveAttribute('aria-controls', 'panel-p1'));
  });

  it('moves focus and selection with arrows, Home and End', async () => {
    render(<Harness />);
    const [overview, info, scripts] = screen.getAllByRole('tab');
    overview?.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(info).toHaveFocus();
    expect(info).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{End}');
    expect(scripts).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(overview).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(scripts).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('tabindex', '0');
  });

  it('shows no scroll arrows when every tab fits', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Scroll tabs left' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scroll tabs right' })).not.toBeInTheDocument();
  });

  it('offers arrows for tabs cut off on either side, and scrolls the bar by a page', () => {
    render(<Harness />);
    const bar = screen.getByRole('tablist');
    // jsdom has no layout: give the bar 300 px of room for 900 px of tabs.
    Object.defineProperty(bar, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: 900 });
    const scrollBy = (bar.scrollBy = vi.fn());
    fireEvent.scroll(bar);
    expect(screen.queryByRole('button', { name: 'Scroll tabs left' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scroll tabs right' }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });

    bar.scrollLeft = 600;
    fireEvent.scroll(bar);
    expect(screen.queryByRole('button', { name: 'Scroll tabs right' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scroll tabs left' }));
    expect(scrollBy).toHaveBeenCalledWith({ left: -240, behavior: 'smooth' });
  });
});
