const { generateWorkflowFromTasks } = require('../services/workflowVisualization');

describe('Workflow Visualization Generator', () => {
  it('should generate a basic flowchart when tasks are provided', () => {
    const tasks = [
      { assignee: 'Alice', description: 'Design homepage' },
      { assignee: 'Bob', description: 'Implement API' }
    ];

    const flowchart = generateWorkflowFromTasks(tasks, 'Sprint Planning');
    
    expect(flowchart).toContain('graph LR');
    expect(flowchart).toContain('Sprint_Planning');
    expect(flowchart).toContain('Alice');
    expect(flowchart).toContain('Bob');
    expect(flowchart).toContain('Design homepage');
    expect(flowchart).toContain('Implement API');
  });

  it('should return a placeholder diagram if no tasks are available', () => {
    const flowchart = generateWorkflowFromTasks([], 'Empty Meeting');
    
    expect(flowchart).toContain('graph LR');
    expect(flowchart).toContain('Empty_Meeting');
    expect(flowchart).toContain('No_Action_Items');
  });
});
