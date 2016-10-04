'use strict';

exports.htmlTemplate = err => `
 <style>
  .bt-error {
    border: 1px solid #ddd;
    border-collapse: collapse;
    padding: 5px;
    border-spacing: 0;
    width: 100%;
  }
  
  .bt-error th {
    border: 1px solid #ddd;
    padding: 5px;
    background: #F0F0F0;
  }
  
  .bt-error td {
    border: 1px solid #ddd;
    padding: 5px;
  }
  </style>
<p>
	Hello,
</p>
<p>
	Kindly review the following errors thrown within the period under review
</p>
<div style="overflow-x:auto;">
		<table class="bt-error">
	    <thead>
	      <tr>
	        <th>Time</th>
	        <th>Exception Type</th>
	        <th>Body</th>
	        <th>Message</th>
	      </tr>
	    </thead>
	    <tbody>
	      <tr>
	        <td>${err.time}</td>
	        <td>${err.source}</td>
	        <td>${err.body || 'Nil'}</td>
	        <td>${err.errorMessage}</td>
	      </tr>
	    </tbody>
	</table>
</div>
<p>
The Bitunnel Team.
</p>
`;


exports.textTemplate = errorArray => `
	Hello,\n
	Kindly review the following errors thrown within the period under review\n\n
	Time\t Exception Type\t Ref\t Message \n
	${errorArray.map(err => `${err.time}\t ${err.source}\t ${err.body || 'Nil'}\t ${err.errorMessage}\n
	`)}	
	The Bitunnel Team.
`;
