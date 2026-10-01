import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
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
    expect(tabs.map((t) => t.id)).toEqual(['tab-p1-overview', 'tab-p1-project-info', 'tab-p1-scripts']);
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
});
