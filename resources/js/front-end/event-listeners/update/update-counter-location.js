import { bench_html, oppBench_html } from '../../front-end.js';

let resizeObserver = new ResizeObserver(entries => {
  entries.forEach(entry => {
    if (entry.target.parentNode.id === 'bench_html' || entry.target.parentNode.id === 'oppBench_html') {
      let sBench;
      if (user === 'self'){
          sBench = bench;
      } else {
          sBench = oppBench;
      }
      for (let i = 0; i < sBench.count; i++){
          const image = sBench.cards[i].image;
          if (image.damageCounter){
              addDamageCounter(user, 'bench', 'bench_html', i, true);
          };
      };
    }
  });
});

// Get all elements inside bench_html and oppBench_html
let elements = [...bench_html.children, ...oppBench_html.children];

// Start observing each element
elements.forEach(element => {
  resizeObserver.observe(element);
});
